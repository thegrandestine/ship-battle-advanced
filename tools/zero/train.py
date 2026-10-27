"""Trains Zero (js/zero.js) from scratch by self-play: PPO on games from tools/zero/selfplay.js.

    python tools/zero/train.py [--run runs/zero] [--iters 1000] [--games 2000] [--resume]
                               [--std 0.2] [--ppool 0.2] [--eval-every 10] [--gm-every 100]

Each iteration: node plays --games self-play games with the current net (31 threads), this
script fits the net to them on the GPU, writes the new net, and every --snap-every iterations
freezes a copy into the opponent pool (past selves to keep beating); shipped releases in --hof
stay in that pool for good. Every --eval-every
iterations it plays the current net (greedy) across every scenario of tools/zero/robust.js against
the Normal AI and a past net (--ref), and every --gm-every iterations a light grandmaster probe:
benchmarks only, nothing from those games is trained on. Watch *_worst: a net that aces the
standard game but folds when the rules change shows up there first (*_far: held-out rules).
Everything lives under --run: net.json (current), pool/, data/, log.jsonl, ckpt.pt.
`--export` writes the current net to js/zero-weights.js for the live game.
"""
import argparse, base64, json, os, random, subprocess, sys, time
import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# sizes; must match js/zero.js
TYPE_DIM, SHIP_DYN, ACT_DYN, GLOBAL_DIM, CELLS = 35, 4, 5, 19, 14
META = dict(phiHidden=64, phi=32, trunk=192, valueHidden=64, actHidden=128)


class ZeroNet(nn.Module):
    def __init__(self, m=META):
        super().__init__()
        self.m = m
        self.phi1 = nn.Linear(TYPE_DIM + SHIP_DYN, m['phiHidden'])
        self.phi2 = nn.Linear(m['phiHidden'], m['phi'])
        self.t1 = nn.Linear(CELLS * m['phi'] + GLOBAL_DIM, m['trunk'])
        self.t2 = nn.Linear(m['trunk'], m['trunk'])
        self.v1 = nn.Linear(m['trunk'], m['valueHidden'])
        self.v2 = nn.Linear(m['valueHidden'], 1)
        self.pq = nn.Linear(m['trunk'], m['actHidden'])
        self.pa = nn.Linear(TYPE_DIM + ACT_DYN, m['actHidden'], bias=False)
        self.po = nn.Linear(m['actHidden'], 1)
        with torch.no_grad():  # start close to uniform play and an even value
            self.po.weight.mul_(0.01); self.po.bias.zero_()
            self.v2.weight.mul_(0.1); self.v2.bias.zero_()

    def forward(self, B, ship_x, ship_seg, glob, act_x, act_seg):
        """ship_seg: sample*CELLS + cell for each ship; act_seg: sample for each action."""
        e = F.relu(self.phi2(F.relu(self.phi1(ship_x))))
        pool = torch.zeros(B * CELLS, e.shape[1], device=e.device).index_add_(0, ship_seg, e)
        pool = torch.log1p(pool).view(B, -1)
        h = F.relu(self.t2(F.relu(self.t1(torch.cat([pool, glob], 1)))))
        value = torch.tanh(self.v2(F.relu(self.v1(h)))).squeeze(1)
        q = self.pq(h)
        logits = self.po(F.relu(q[act_seg] + self.pa(act_x))).squeeze(1)
        return logits, value


def seg_logsoftmax(logits, seg, B):
    m = torch.full((B,), -1e30, device=logits.device).scatter_reduce(0, seg, logits, 'amax', include_self=True)
    z = torch.exp(logits - m[seg])
    s = torch.zeros(B, device=logits.device).index_add_(0, seg, z)
    return logits - (torch.log(s) + m)[seg]


def load_batch(base, dev):
    hdr = json.load(open(base + '.json'))
    # (no numpy: this torch build and the installed numpy 2 don't mix)
    raw = torch.frombuffer(bytearray(open(base + '.bin', 'rb').read()), dtype=torch.uint8)
    A = {}
    for a in hdr['arrays']:
        dt = torch.float32 if a['dtype'] == 'f4' else torch.int32
        A[a['name']] = raw[a['offset']:a['offset'] + 4 * a['count']].view(dt).to(dev)
    d = hdr['dims']
    assert d['TYPE_DIM'] == TYPE_DIM and d['GLOBAL_DIM'] == GLOBAL_DIM, d
    nt = d['N_TYPES'] + 1
    A['tables'] = A['tables'].view(hdr['games'], nt, TYPE_DIM)
    A['nt'] = nt
    A['s_global'] = A['s_global'].view(-1, GLOBAL_DIM)
    A['sh_dyn'] = A['sh_dyn'].view(-1, SHIP_DYN)
    A['a_dyn'] = A['a_dyn'].view(-1, ACT_DYN)
    for k in ('ship', 'act'):
        c = A[f's_{k}_cnt'].long()
        A[f's_{k}_cnt'] = c
        A[f's_{k}_off'] = torch.cumsum(c, 0) - c
    A['N'] = A['s_game'].shape[0]
    return A


def gather_segments(off, cnt):
    """Concatenated row indices of segments [off[i], off[i]+cnt[i]), plus which segment each came from."""
    owner = torch.repeat_interleave(torch.arange(len(cnt), device=cnt.device), cnt)
    starts = torch.cumsum(cnt, 0) - cnt
    idx = off[owner] + (torch.arange(int(cnt.sum()), device=cnt.device) - starts[owner])
    return idx, owner


def minibatch_inputs(A, mb):
    B = len(mb)
    games = A['s_game'][mb].long()
    si, so = gather_segments(A['s_ship_off'][mb], A['s_ship_cnt'][mb])
    ship_x = torch.cat([A['tables'][games[so], A['sh_type'][si].long()], A['sh_dyn'][si]], 1)
    ship_seg = so * CELLS + A['sh_cell'][si].long()
    ai, ao = gather_segments(A['s_act_off'][mb], A['s_act_cnt'][mb])
    act_x = torch.cat([A['tables'][games[ao], A['a_type'][ai].long()], A['a_dyn'][ai]], 1)
    # index of each sample's chosen action within the minibatch's action rows
    act_start = torch.cumsum(A['s_act_cnt'][mb], 0) - A['s_act_cnt'][mb]
    chosen = act_start + A['s_chosen'][mb].long()
    return B, ship_x, ship_seg, A['s_global'][mb], act_x, ao, chosen


def ppo_update(net, opt, A, args):
    N = A['N']
    adv = A['s_adv']
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)
    stats = []
    for _ in range(args.epochs):
        perm = torch.randperm(N, device=adv.device)
        for k in range(0, N, args.mb):
            mb = perm[k:k + args.mb]
            B, ship_x, ship_seg, glob, act_x, act_seg, chosen = minibatch_inputs(A, mb)
            logits, value = net(B, ship_x, ship_seg, glob, act_x, act_seg)
            logp_all = seg_logsoftmax(logits, act_seg, B)
            logp = logp_all[chosen]
            ent = -torch.zeros(B, device=logits.device).index_add_(0, act_seg, torch.exp(logp_all) * logp_all)
            ratio = torch.exp(logp - A['s_logp'][mb])
            a = adv[mb]
            pl = -torch.min(ratio * a, torch.clamp(ratio, 1 - args.clip, 1 + args.clip) * a).mean()
            vl = F.mse_loss(value, A['s_ret'][mb])
            el = ent.mean()
            loss = pl + args.vcoef * vl - args.ent * el
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
            with torch.no_grad():
                kl = (A['s_logp'][mb] - logp).mean().item()
                cf = ((ratio - 1).abs() > args.clip).float().mean().item()
            stats.append((pl.item(), vl.item(), el.item(), kl, cf))
    s = [sum(c) / len(c) for c in zip(*stats)]
    return dict(pl=s[0], vl=s[1], ent=s[2], kl=s[3], clipfrac=s[4])


def export(net, path):
    params = {}
    for k, v in net.state_dict().items():
        a = v.detach().cpu().float().contiguous()
        params[k] = dict(shape=list(a.shape), b64=base64.b64encode(bytes(a.view(-1).view(torch.uint8).tolist())).decode())
    with open(path, 'w') as f:
        json.dump(dict(meta=net.m, params=params), f)


def node(args_list, **kw):
    return subprocess.run(['node', *args_list], cwd=ROOT, capture_output=True, text=True, **kw)


def robust(net_path, opp, per, threads, opp_cfg=None, scen=None):
    """Zero (greedy) vs opp over every scenario in tools/zero/scenarios.js: {table, mean, worst}."""
    cmd = ['tools/zero/robust.js', 'zero', opp, str(per), '--a', json.dumps(dict(weights=net_path, temp=0)),
           '--seed', str(random.randint(1, 10**6)), '--threads', str(threads), '--json']
    if opp_cfg:
        cmd += ['--b', json.dumps(opp_cfg)]
    if scen:
        cmd += ['--scen', scen]
    r = node(cmd)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        print(r.stdout, r.stderr, flush=True)
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', default='runs/zero')
    ap.add_argument('--iters', type=int, default=1000)
    ap.add_argument('--games', type=int, default=2000)
    ap.add_argument('--std', type=float, default=0.3)
    ap.add_argument('--classic', type=float, default=0.25, help='share of plain games on the Classic board (the rest roll Standard)')
    ap.add_argument('--focus', default='', help='family:share, e.g. midgame:0.4: that share of games goes to one family (experiments)')
    ap.add_argument('--ppool', type=float, default=0.2)
    ap.add_argument('--pgm', type=float, default=0, help='share of games vs grandmaster v1.2 (slow)')
    ap.add_argument('--open', type=int, default=3)
    ap.add_argument('--lr', type=float, default=3e-4)
    ap.add_argument('--epochs', type=int, default=3)
    ap.add_argument('--mb', type=int, default=8192)
    ap.add_argument('--clip', type=float, default=0.2)
    ap.add_argument('--vcoef', type=float, default=0.5)
    ap.add_argument('--ent', type=float, default=0.01)
    ap.add_argument('--snap-every', type=int, default=10)
    ap.add_argument('--pool-size', type=int, default=12)
    ap.add_argument('--hof', default='runs/hof', help='hall of fame: shipped releases, always in the opponent pool')
    ap.add_argument('--eval-every', type=int, default=10)
    ap.add_argument('--eval-games', type=int, default=30, help='per scenario, vs Normal and vs --ref')
    ap.add_argument('--ref', default='runs/zero1/pool/it00140.json', help='a past net to keep beating (shipped v0.2)')
    ap.add_argument('--std-games', type=int, default=200, help='standard games vs --ref: the deciding number, so a big sample')
    ap.add_argument('--gm-every', type=int, default=100)
    ap.add_argument('--gm-games', type=int, default=10, help='per scenario: a light probe, not a verdict')
    ap.add_argument('--threads', type=int, default=max(1, os.cpu_count() - 1))
    ap.add_argument('--resume', action='store_true')
    ap.add_argument('--init', help='start from this exported net (a pool/*.json) instead of random weights')
    ap.add_argument('--export', action='store_true')
    args = ap.parse_args()

    run = os.path.join(ROOT, args.run)
    for d in ('pool', 'data'):
        os.makedirs(os.path.join(run, d), exist_ok=True)
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    net = ZeroNet().to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr)
    it0 = 0
    ckpt = os.path.join(run, 'ckpt.pt')
    if (args.resume or args.export) and os.path.exists(ckpt):
        c = torch.load(ckpt, map_location=dev)
        net.load_state_dict(c['net']); opt.load_state_dict(c['opt']); it0 = c['it']
    if args.init:
        js = json.load(open(os.path.join(ROOT, args.init)))
        sd = {k: torch.frombuffer(bytearray(base64.b64decode(v['b64'])), dtype=torch.float32).view(v['shape']) for k, v in js['params'].items()}
        net.load_state_dict(sd)
        it0 = js['meta'].get('iteration', it0)
    net_path = os.path.join(run, 'net.json')
    if args.export:
        export(net, net_path)
        js = json.load(open(net_path))
        js['meta']['iteration'] = it0
        with open(os.path.join(ROOT, 'js', 'zero-weights.js'), 'w') as f:
            f.write('// Zero\'s trained net (tools/zero/train.py --export). Iteration %d.\n' % it0)
            f.write('export const ZERO_WEIGHTS = ' + json.dumps(js) + ';\n')
        print('exported iteration', it0)
        return
    export(net, net_path)
    print(f'params: {sum(p.numel() for p in net.parameters())}, device {dev}')
    log = open(os.path.join(run, 'log.jsonl'), 'a')

    for it in range(it0 + 1, args.iters + 1):
        t0 = time.time()
        pool = sorted(f for f in os.listdir(os.path.join(run, 'pool')) if f.endswith('.json'))
        pool_paths = [os.path.join(run, 'pool', f) for f in pool[-args.pool_size:]]
        # The recent pool only remembers ~pool_size×snap_every iterations; a style that drifts
        # away from an old release's can lose to it again (iteration 1250 beat its neighbours but
        # lost 60/40 to Alpha 0.75). Shipped releases stay in the pool for good.
        hof = os.path.join(ROOT, args.hof)
        if os.path.isdir(hof):
            pool_paths += [os.path.join(hof, f) for f in sorted(os.listdir(hof)) if f.endswith('.json')]
        data = os.path.join(run, 'data', 'batch')
        for attempt in range(3):  # (a retry survives game files being edited mid-run)
            r = node(['tools/zero/selfplay.js', '--net', net_path, '--games', str(args.games), '--out', data,
                      '--pool', ','.join(pool_paths), '--ppool', str(args.ppool if pool_paths else 0), '--pgm', str(args.pgm),
                      '--std', str(args.std), '--classic', str(args.classic), *(['--focus', args.focus] if args.focus else []), '--open', str(args.open), '--seed', str(it), '--threads', str(args.threads)])
            if not r.returncode:
                break
            print(r.stdout, r.stderr, flush=True)
            time.sleep(5)
        else:
            sys.exit(1)
        sp = json.loads(r.stdout.strip().splitlines()[-1])
        t1 = time.time()
        A = load_batch(data, dev)
        st = ppo_update(net, opt, A, args)
        del A
        export(net, net_path)
        rec = dict(it=it, **sp, **{k: round(float(v), 4) for k, v in st.items()}, selfplay_s=round(t1 - t0, 1), train_s=round(time.time() - t1, 1))
        if it % args.snap_every == 0:
            export(net, os.path.join(run, 'pool', f'it{it:05d}.json'))
        torch.save(dict(net=net.state_dict(), opt=opt.state_dict(), it=it), ckpt)
        if args.eval_every and it % args.eval_every == 0:
            t2 = time.time()
            probes = [('normal', 'normal', args.eval_games, None), ('ref', 'zero', args.eval_games, dict(weights=os.path.join(ROOT, args.ref), temp=0))]
            if args.gm_every and it % args.gm_every == 0:
                probes.append(('gm', 'gm', args.gm_games, None))
            for tag, opp, per, cfg in probes:
                r = robust(net_path, opp, per, args.threads, cfg)
                if r:
                    for k in ('near', 'nearWorst', 'far', 'farWorst'):
                        rec[f'{tag}_{k}'] = r[k]
                    rec[f'{tag}_table'] = {k: v['score'] for k, v in r['table'].items()}
            # standard decides which net is stronger, so it gets a sample big enough to trust (±3)
            r = robust(net_path, 'zero', args.std_games, args.threads, dict(weights=os.path.join(ROOT, args.ref), temp=0), scen='standard')
            if r:
                rec['ref_std'], rec['ref_std_se'] = r['table']['standard']['score'], r['table']['standard']['se']
            rec['eval_s'] = round(time.time() - t2, 1)
        print(json.dumps(rec), flush=True)
        log.write(json.dumps(rec) + '\n'); log.flush()


if __name__ == '__main__':
    main()
