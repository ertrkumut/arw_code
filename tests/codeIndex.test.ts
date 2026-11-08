import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CodeIndex } from '../src/main/codeIndex'
import { searchText, buildMatcher, maskMatcher } from '../src/main/findInFiles'

const ENEMY = `namespace Game
{
    public abstract class Enemy : MonoBehaviour, IDamageable
    {
        /// <summary>Hit points.</summary>
        public int health = 10;
        public Weapon weapon;

        public virtual void Hit(int amount, bool crit = false) { health -= amount; }
        public abstract void Attack();
    }

    public interface IDamageable { void Hit(int amount, bool crit = false); }
}
`
const GOBLIN = `namespace Game
{
    public class Goblin : Enemy
    {
        public override void Attack() { weapon.Fire(3); }
        public override void Hit(int amount, bool crit = false) { base.Hit(amount, crit); }
        void Update() { }
    }
}
`
const WEAPON = `namespace Game
{
    public class Weapon
    {
        public float damage;
        public void Fire(int shots) { }
        public Weapon Clone() => new Weapon();
    }
}
`
const PLAYER = `using Game;
public class Player : MonoBehaviour
{
    private Enemy target;
    private List<Enemy> enemies;

    void Start()
    {
        var g = GetComponent<Goblin>();
        g.Hit(5, true);
        target.weapon.Fire(2);
        target.weapon.Clone().damage = 2;
        enemies[0].Attack();
        transform.position = default;
        var w = new Weapon();
        w.
    }
}
`

let dir: string
let ix: CodeIndex
const P = (n: string) => join(dir, 'Assets', n)
const off = (src: string, needle: string, delta = 0) => src.indexOf(needle) + delta

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'arw-code-'))
  mkdirSync(join(dir, 'Assets'))
  mkdirSync(join(dir, 'Library'))
  writeFileSync(P('Enemy.cs'), ENEMY)
  writeFileSync(P('Goblin.cs'), GOBLIN)
  writeFileSync(P('Weapon.cs'), WEAPON)
  writeFileSync(P('Player.cs'), PLAYER)
  writeFileSync(join(dir, 'Library', 'Junk.cs'), 'class Junk {}')
  ix = new CodeIndex(dir, () => {})
  await ix.ready()
})
afterAll(() => { ix.dispose(); rmSync(dir, { recursive: true, force: true }) })

describe('CodeIndex', () => {
  it('indexes project files, skipping Library', () => {
    expect(ix.status.state).toBe('ready')
    expect(ix.status.files).toBe(4)
    expect(ix.byName('Junk')).toEqual([])
  })

  it('Ctrl+Click: member through a typed field chain', () => {
    const r = ix.resolve(P('Player.cs'), PLAYER, off(PLAYER, 'Fire(2)'))
    expect(r.kind).toBe('symbols')
    if (r.kind !== 'symbols') return
    expect(r.exact).toBe(true)
    expect(r.targets.map(t => `${t.container}.${t.name}`)).toEqual(['Weapon.Fire'])
  })

  it('Ctrl+Click: method through GetComponent<T>() local', () => {
    const r = ix.resolve(P('Player.cs'), PLAYER, off(PLAYER, 'Hit(5'))
    if (r.kind !== 'symbols') throw new Error(r.kind)
    expect(r.targets[0].container).toBe('Goblin')
  })

  it('Ctrl+Click: method return type chain and list indexer', () => {
    const r = ix.resolve(P('Player.cs'), PLAYER, off(PLAYER, 'damage = 2'))
    if (r.kind !== 'symbols') throw new Error(r.kind)
    expect(r.targets[0].container).toBe('Weapon')
    const r2 = ix.resolve(P('Player.cs'), PLAYER, off(PLAYER, 'Attack();'))
    if (r2.kind !== 'symbols') throw new Error(r2.kind)
    expect(r2.targets[0].container).toBe('Enemy')
  })

  it('Ctrl+Click: inherited field from a base class', () => {
    const r = ix.resolve(P('Goblin.cs'), GOBLIN, off(GOBLIN, 'weapon.Fire'))
    if (r.kind !== 'symbols') throw new Error(r.kind)
    expect(r.targets[0].container).toBe('Enemy')
    expect(r.targets[0].name).toBe('weapon')
  })

  it('Ctrl+Click: type name and local variable', () => {
    const r = ix.resolve(P('Player.cs'), PLAYER, off(PLAYER, 'Enemy target'))
    if (r.kind !== 'symbols') throw new Error(r.kind)
    expect(r.targets[0].kind).toBe('class')
    const l = ix.resolve(P('Player.cs'), PLAYER, off(PLAYER, 'g.Hit'))
    expect(l.kind).toBe('local')
  })

  it('Ctrl+Click on a declaration reports onDecl (→ show usages)', () => {
    const r = ix.resolve(P('Weapon.cs'), WEAPON, off(WEAPON, 'Fire('))
    expect(r.kind === 'symbols' && r.onDecl).toBe(true)
  })

  it('external Unity members resolve as external', () => {
    const r = ix.resolve(P('Player.cs'), PLAYER, off(PLAYER, 'position'))
    expect(r.kind).toBe('external')
    if (r.kind === 'external') expect(r.typeName).toBe('Transform')
  })

  it('finds usages, skipping other symbols\' declarations', () => {
    const fire = ix.byName('Fire')[0]
    const u = ix.usages('Fire', fire)
    expect(u.filter(x => !x.decl).length).toBe(2)
    const hit = ix.byName('Hit').find(s => s.container === 'Enemy')!
    const hu = ix.usages('Hit', hit)
    // Goblin.Hit and IDamageable.Hit declarations are excluded; Enemy.Hit decl is flagged
    expect(hu.filter(x => x.decl).length).toBe(1)
    expect(hu.filter(x => !x.decl).map(x => x.text)).toEqual(expect.arrayContaining(['g.Hit(5, true);']))
  })

  it('implementations and super', () => {
    const enemy = ix.byName('Enemy').find(s => s.kind === 'class')!
    expect(ix.implementations(enemy).map(t => t.name)).toEqual(['Goblin'])
    const attack = ix.byName('Attack').find(s => s.container === 'Enemy')!
    expect(ix.implementations(attack).map(t => t.container)).toEqual(['Goblin'])
    const iface = ix.byName('IDamageable').find(s => s.kind === 'interface')!
    expect(ix.implementations(iface).map(t => t.name).sort()).toEqual(['Enemy', 'Goblin'])
    const sup = ix.superOf(P('Goblin.cs'), GOBLIN, off(GOBLIN, 'weapon.Fire'))
    expect(sup.targets.map(t => `${t.container}.${t.name}`)).toEqual(['Enemy.Attack'])
  })

  it('completion after a dot lists members of the inferred type', () => {
    const items = ix.complete(P('Player.cs'), PLAYER, off(PLAYER, 'w.\n', 2))
    expect(items.map(i => i.label).sort()).toEqual(['Clone', 'Fire', 'damage'])
  })

  it('completion at member level offers Unity event functions', () => {
    const src = PLAYER.replace('    void Start()', '    void Upd\n    void Start()')
    const items = ix.complete(P('Player.cs'), src, off(src, 'Upd', 3))
    const upd = items.find(i => i.label === 'Update')
    expect(upd?.kind).toBe('unityMessage')
    expect(items.find(i => i.label === 'Start' && i.kind === 'unityMessage')).toBeUndefined()   // already declared
  })

  it('signature help and inlay hints', () => {
    const src = PLAYER.replace('g.Hit(5, true);', 'g.Hit(5, ')
    const sig = ix.signature(P('Player.cs'), src, off(src, 'g.Hit(5, ', 9))!
    expect(sig.activeParameter).toBe(1)
    expect(sig.signatures[0].label).toBe('void Hit(int amount, bool crit = false)')
    const hints = ix.inlay(P('Player.cs'), PLAYER, 1, 30)
    expect(hints.map(h => h.label)).toEqual(expect.arrayContaining(['amount:', 'crit:', 'shots:']))
  })

  it('code vision data', () => {
    const lens = ix.lens(P('Goblin.cs'), GOBLIN)
    const upd = lens.find(l => l.name === 'Update')!
    expect(upd.unityEvent).toBe(true)
    expect(lens.find(l => l.name === 'Goblin')!.unityScript).toBe(true)
    expect(lens.find(l => l.name === 'Attack')!.overrides).toBe(true)
    const el = ix.lens(P('Enemy.cs'), ENEMY)
    expect(el.find(l => l.name === 'Enemy')!.implementations).toBe(1)
    expect(el.find(l => l.name === 'health')!.usages).toBe(1)
  })

  it('search with camel humps and Type.member', () => {
    expect(ix.search('Gob', 'types')[0].name).toBe('Goblin')
    expect(ix.search('Weapon.Fi', 'symbols')[0].name).toBe('Fire')
  })

  it('overlays unsaved buffers', async () => {
    await ix.update(P('Weapon.cs'), WEAPON.replace('public float damage;', 'public float damage;\n        public int ammo;'))
    expect(ix.byName('ammo').length).toBe(1)
    await ix.update(P('Weapon.cs'), null)
    expect(ix.byName('ammo').length).toBe(0)
  })
})

describe('findInFiles helpers', () => {
  it('matches whole words / case and builds previews', () => {
    const out: any[] = []
    searchText('a.cs', 'int Fire = 1;\nfire();\nFireball', buildMatcher({ query: 'Fire', wholeWord: true, matchCase: true }), out, 100)
    expect(out.map(o => [o.line, o.col])).toEqual([[1, 5]])
    expect(maskMatcher('*.cs, *.shader')('A.cs')).toBe(true)
    expect(maskMatcher('*.cs')('A.json')).toBe(false)
  })
})
