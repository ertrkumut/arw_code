import { describe, it, expect } from 'vitest'
import {
  maskCode, parseCSharp, wordOccurrences, findLocalDeclaration, qualifierChain, inferInitType,
  simpleTypeName, docToMarkdown, fuzzyName, symbolAt, countWords
} from '../src/shared/csharp'

const SRC = `using UnityEngine;
using System.Collections.Generic;

namespace Game.Player
{
    /// <summary>Moves the player around.</summary>
    [RequireComponent(typeof(Rigidbody))]
    public class PlayerController : MonoBehaviour, IDamageable
    {
        [SerializeField] private float speed = 5f;
        public int Health { get; private set; } = 100;
        private List<Enemy> enemies = new List<Enemy> { };
        public event System.Action<int> OnDamaged;
        private const string Tag = "Player // not a comment";
        int a, b = 2, c;

        public PlayerController() { }

        /// <summary>Apply damage.</summary>
        /// <param name="amount">How much.</param>
        public void TakeDamage(int amount, bool crit = false)
        {
            var rb = GetComponent<Rigidbody>();
            foreach (var e in enemies) { e.Hit(amount); }
            Health -= amount; // "string" in comment
            OnDamaged?.Invoke(amount);
        }

        private void Update() => Move(transform.position.normalized);

        void Move(Vector3 dir) { rb2.velocity = dir * speed; }

        public float Speed => speed;

        public enum State { Idle, Running = 2, [Obsolete] Dead }

        private struct Inner { public int x; }
    }

    public interface IDamageable { void TakeDamage(int amount, bool crit = false); }

    public delegate void Hit(int dmg);
}
`

describe('maskCode', () => {
  it('blanks comments and string contents, keeps length and newlines', () => {
    const src = 'var s = "a // b"; // tail\n/* x */ int y = $"{name} {{x}}"; char c = \'"\';'
    const m = maskCode(src)
    expect(m.length).toBe(src.length)
    expect(m).not.toContain('tail')
    expect(m).not.toContain('a // b')
    expect(m).toContain('name')          // interpolation hole stays code
    expect(m.split('\n').length).toBe(2)
    expect(m).toContain('int y')
  })
  it('blanks preprocessor lines and verbatim strings', () => {
    const m = maskCode('#region Foo\nvar p = @"C:\\x""y";\n#endregion')
    expect(m).not.toContain('Foo')
    expect(m).not.toContain('C:')
    expect(m).toContain('var p')
  })
})

describe('parseCSharp', () => {
  const f = parseCSharp(SRC)
  const byName = (n: string) => f.symbols.filter(s => s.name === n)

  it('reads usings and namespaces', () => {
    expect(f.usings).toEqual(['UnityEngine', 'System.Collections.Generic'])
    expect(byName('PlayerController')[0].namespace).toBe('Game.Player')
  })
  it('finds the class with bases, docs and attributes', () => {
    const c = byName('PlayerController').find(s => s.kind === 'class')!
    expect(c.bases).toEqual(['MonoBehaviour', 'IDamageable'])
    expect(c.doc).toContain('Moves the player')
    expect(c.attributes?.[0]).toContain('RequireComponent')
    expect(c.line).toBe(8)
    expect(SRC.split('\n')[c.line - 1].slice(c.col - 1).startsWith('PlayerController')).toBe(true)
    expect(c.endLine).toBeGreaterThan(30)
  })
  it('finds members of every kind', () => {
    const kinds = Object.fromEntries(f.symbols.map(s => [`${s.container}::${s.name}`, s.kind]))
    expect(kinds['PlayerController::speed']).toBe('field')
    expect(kinds['PlayerController::Health']).toBe('property')
    expect(kinds['PlayerController::enemies']).toBe('field')
    expect(kinds['PlayerController::OnDamaged']).toBe('event')
    expect(kinds['PlayerController::Tag']).toBe('const')
    expect(kinds['PlayerController::a']).toBe('field')
    expect(kinds['PlayerController::b']).toBe('field')
    expect(kinds['PlayerController::c']).toBe('field')
    expect(kinds['PlayerController::TakeDamage']).toBe('method')
    expect(kinds['PlayerController::Update']).toBe('method')
    expect(kinds['PlayerController::Move']).toBe('method')
    expect(kinds['PlayerController::Speed']).toBe('property')
    expect(kinds['PlayerController::State']).toBe('enum')
    expect(kinds['PlayerController.State::Running']).toBe('enumMember')
    expect(kinds['PlayerController.State::Dead']).toBe('enumMember')
    expect(kinds['PlayerController::Inner']).toBe('struct')
    expect(kinds['PlayerController.Inner::x']).toBe('field')
    expect(kinds['IDamageable::TakeDamage']).toBe('method')
    expect(kinds['null::Hit']).toBe('delegate')
    expect(f.symbols.filter(s => s.kind === 'constructor').map(s => s.name)).toEqual(['PlayerController'])
    // no duplicates from expression bodies
    expect(byName('Update').length).toBe(1)
  })
  it('parses method signatures and params', () => {
    const m = byName('TakeDamage').find(s => s.container === 'PlayerController')!
    expect(m.type).toBe('void')
    expect(m.params).toEqual([{ type: 'int', name: 'amount', modifier: undefined, def: undefined }, { type: 'bool', name: 'crit', modifier: undefined, def: 'false' }])
    expect(m.signature).toBe('public void TakeDamage(int amount, bool crit = false)')
    expect(m.doc).toContain('Apply damage')
    expect(m.modifiers).toEqual(['public'])
    expect(byName('enemies')[0].type).toBe('List<Enemy>')
  })
})

describe('locals and qualifiers', () => {
  const masked = maskCode(SRC)
  const f = parseCSharp(SRC, masked)
  it('finds local declarations and parameters', () => {
    const use = SRC.indexOf('e.Hit')
    const d = findLocalDeclaration(SRC, masked, f, use, 'e')!
    expect(d).toBeTruthy()
    expect(d.isParam).toBe(false)
    expect(SRC.slice(d.offset, d.offset + 1)).toBe('e')
    const rbUse = SRC.indexOf('var rb') + 4
    const rb = findLocalDeclaration(SRC, masked, f, rbUse, 'rb')!
    expect(inferInitType(rb.init)).toBe('Rigidbody')
    const p = findLocalDeclaration(SRC, masked, f, SRC.indexOf('Health -= amount') + 10, 'amount')!
    expect(p.isParam).toBe(true)
    expect(p.type).toBe('int')
  })
  it('reads qualifier chains', () => {
    const at = SRC.indexOf('normalized')
    expect(qualifierChain(masked, at)).toEqual(['transform', 'position'])
    expect(qualifierChain('GetComponent<Foo>().bar', 'GetComponent<Foo>().'.length)).toEqual(['GetComponent<Foo>()'])
    expect(qualifierChain('a?.b', 3)).toEqual(['a'])
  })
  it('symbolAt picks the innermost', () => {
    expect(symbolAt(f, SRC.indexOf('foreach'))?.name).toBe('TakeDamage')
  })
})

describe('helpers', () => {
  it('simpleTypeName', () => {
    expect(simpleTypeName('List<Enemy>[]?')).toBe('List')
    expect(simpleTypeName('UnityEngine.MonoBehaviour')).toBe('MonoBehaviour')
  })
  it('wordOccurrences respects word boundaries', () => {
    expect(wordOccurrences('speed speedy _speed speed', 'speed')).toEqual([0, 20])
  })
  it('countWords skips keywords', () => {
    const c = countWords(maskCode(SRC))
    expect(c.get('speed')).toBe(3)
    expect(c.has('public')).toBe(false)
  })
  it('docToMarkdown', () => {
    expect(docToMarkdown('<summary>Hi <see cref="T:Foo.Bar"/></summary>\n<param name="x">the x</param>')).toBe('Hi `Bar`\n\n**Parameters**\n\n- `x` — the x')
  })
  it('fuzzyName camel humps', () => {
    expect(fuzzyName('PC', 'PlayerController')).toBeGreaterThan(fuzzyName('PC', 'Pickup'))
    expect(fuzzyName('xyz', 'PlayerController')).toBe(-1)
    expect(fuzzyName('play', 'PlayerController')).toBeGreaterThan(0)
  })
})
