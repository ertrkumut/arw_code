/** Rider-style live templates (type the key, then Tab/Enter in completion) and Surround With. */

export interface LiveTemplate { key: string; description: string; body: string }

export const LIVE_TEMPLATES: LiveTemplate[] = [
  { key: 'for', description: 'Simple for loop', body: 'for (int ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++)\n{\n\t$0\n}' },
  { key: 'forr', description: 'Reverse for loop', body: 'for (int ${1:i} = ${2:length} - 1; ${1:i} >= 0; ${1:i}--)\n{\n\t$0\n}' },
  { key: 'foreach', description: 'foreach block', body: 'foreach (var ${1:item} in ${2:collection})\n{\n\t$0\n}' },
  { key: 'if', description: 'if statement', body: 'if (${1:condition})\n{\n\t$0\n}' },
  { key: 'ife', description: 'if / else', body: 'if (${1:condition})\n{\n\t$2\n}\nelse\n{\n\t$0\n}' },
  { key: 'while', description: 'while loop', body: 'while (${1:condition})\n{\n\t$0\n}' },
  { key: 'do', description: 'do…while loop', body: 'do\n{\n\t$0\n} while (${1:condition});' },
  { key: 'switch', description: 'switch statement', body: 'switch (${1:value})\n{\n\tcase ${2:x}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}' },
  { key: 'try', description: 'try / catch', body: 'try\n{\n\t$1\n}\ncatch (${2:Exception} ${3:e})\n{\n\t$0\n}' },
  { key: 'tryf', description: 'try / finally', body: 'try\n{\n\t$1\n}\nfinally\n{\n\t$0\n}' },
  { key: 'using', description: 'using block', body: 'using (${1:var} ${2:resource} = ${3:expression})\n{\n\t$0\n}' },
  { key: 'lock', description: 'lock block', body: 'lock (${1:syncRoot})\n{\n\t$0\n}' },
  { key: 'prop', description: 'Auto-property', body: 'public ${1:int} ${2:Name} { get; set; }$0' },
  { key: 'propg', description: 'Auto-property with private setter', body: 'public ${1:int} ${2:Name} { get; private set; }$0' },
  { key: 'ctor', description: 'Constructor', body: 'public ${1:ClassName}($2)\n{\n\t$0\n}' },
  { key: 'class', description: 'Class', body: 'public class ${1:Name}\n{\n\t$0\n}' },
  { key: 'interface', description: 'Interface', body: 'public interface ${1:IName}\n{\n\t$0\n}' },
  { key: 'enum', description: 'Enum', body: 'public enum ${1:Name}\n{\n\t$0\n}' },
  { key: 'region', description: '#region', body: '#region ${1:Name}\n$0\n#endregion' },
  { key: 'cw', description: 'Console.WriteLine', body: 'System.Console.WriteLine($0);' },
  { key: 'thr', description: 'throw new Exception', body: 'throw new ${1:System.Exception}(${2:"message"});' },
  // ---- Unity ----
  { key: 'dl', description: 'Debug.Log', body: 'Debug.Log($0);' },
  { key: 'dlw', description: 'Debug.LogWarning', body: 'Debug.LogWarning($0);' },
  { key: 'dle', description: 'Debug.LogError', body: 'Debug.LogError($0);' },
  { key: 'sfield', description: '[SerializeField] private field', body: '[SerializeField] private ${1:float} ${2:value};$0' },
  { key: 'header', description: '[Header] attribute', body: '[Header("${1:Section}")]$0' },
  { key: 'tooltip', description: '[Tooltip] attribute', body: '[Tooltip("${1:text}")]$0' },
  { key: 'coroutine', description: 'Coroutine method', body: 'private IEnumerator ${1:Routine}()\n{\n\t$0\n\tyield return null;\n}' },
  { key: 'gc', description: 'GetComponent<T>()', body: 'GetComponent<${1:Rigidbody}>()$0' },
  { key: 'mb', description: 'MonoBehaviour class', body: 'using UnityEngine;\n\npublic class ${1:NewBehaviour} : MonoBehaviour\n{\n\tprivate void Start()\n\t{\n\t\t$0\n\t}\n\n\tprivate void Update()\n\t{\n\t}\n}' },
  { key: 'so', description: 'ScriptableObject class', body: 'using UnityEngine;\n\n[CreateAssetMenu(fileName = "${1:NewData}", menuName = "${2:Game}/${1:NewData}")]\npublic class ${1:NewData} : ScriptableObject\n{\n\t$0\n}' },
  { key: 'menuitem', description: 'Editor menu item', body: '[UnityEditor.MenuItem("${1:Tools}/${2:Do Something}")]\nprivate static void ${3:DoSomething}()\n{\n\t$0\n}' }
]

export interface SurroundTemplate { key: string; name: string; /** $SELECTION is replaced by the (indented) selected lines */ body: string }

export const SURROUND_TEMPLATES: SurroundTemplate[] = [
  { key: '1', name: 'if', body: 'if (${1:condition})\n{\n$SELECTION\n}$0' },
  { key: '2', name: 'if / else', body: 'if (${1:condition})\n{\n$SELECTION\n}\nelse\n{\n\t$0\n}' },
  { key: '3', name: 'while', body: 'while (${1:condition})\n{\n$SELECTION\n}$0' },
  { key: '4', name: 'for', body: 'for (int ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++)\n{\n$SELECTION\n}$0' },
  { key: '5', name: 'foreach', body: 'foreach (var ${1:item} in ${2:collection})\n{\n$SELECTION\n}$0' },
  { key: '6', name: 'try / catch', body: 'try\n{\n$SELECTION\n}\ncatch (${1:System.Exception} ${2:e})\n{\n\t$0\n}' },
  { key: '7', name: 'try / finally', body: 'try\n{\n$SELECTION\n}\nfinally\n{\n\t$0\n}' },
  { key: '8', name: 'using', body: 'using (${1:resource})\n{\n$SELECTION\n}$0' },
  { key: '9', name: 'lock', body: 'lock (${1:syncRoot})\n{\n$SELECTION\n}$0' },
  { key: '0', name: '{ } block', body: '{\n$SELECTION\n}$0' },
  { key: 'R', name: '#region', body: '#region ${1:Name}\n$SELECTION\n#endregion$0' }
]

/** Escape text so it inserts literally inside a snippet. */
export const snippetEscape = (s: string) => s.replace(/[\\$}]/g, m => '\\' + m)
