/**
 * Bits of the Unity API the IDE knows without the engine's assemblies: MonoBehaviour
 * "event functions" (messages Unity calls by name) and the base classes that receive them.
 * Used for gutter icons, Code Vision, hover docs and completion — like Rider's Unity plugin.
 */

export interface UnityMessage { name: string; signature: string; doc: string }

const M = (signature: string, doc: string): UnityMessage => ({ name: /(\w+)\s*\(/.exec(signature)![1], signature, doc })

export const UNITY_MESSAGES: UnityMessage[] = [
  M('void Awake()', 'Called when the script instance is being loaded, before any Start.'),
  M('void Start()', 'Called on the frame when the script is enabled, just before any Update is called the first time.'),
  M('void Update()', 'Called every frame, if the MonoBehaviour is enabled.'),
  M('void FixedUpdate()', 'Called every fixed frame-rate frame. Use it for physics.'),
  M('void LateUpdate()', 'Called every frame after all Update functions have been called.'),
  M('void OnEnable()', 'Called when the object becomes enabled and active.'),
  M('void OnDisable()', 'Called when the behaviour becomes disabled or inactive.'),
  M('void OnDestroy()', 'Called when the MonoBehaviour will be destroyed.'),
  M('void OnValidate()', 'Editor-only: called when the script is loaded or a value changes in the Inspector.'),
  M('void Reset()', 'Editor-only: called when the user hits Reset in the Inspector or first adds the component.'),
  M('void OnApplicationQuit()', 'Sent to all GameObjects before the application quits.'),
  M('void OnApplicationPause(bool pauseStatus)', 'Sent to all GameObjects when the application pauses.'),
  M('void OnApplicationFocus(bool hasFocus)', 'Sent to all GameObjects when the player gets or loses focus.'),
  M('void OnTriggerEnter(Collider other)', 'Called when a Collider enters the trigger.'),
  M('void OnTriggerStay(Collider other)', 'Called once per physics update for every Collider touching the trigger.'),
  M('void OnTriggerExit(Collider other)', 'Called when a Collider has stopped touching the trigger.'),
  M('void OnCollisionEnter(Collision collision)', 'Called when this collider/rigidbody has begun touching another rigidbody/collider.'),
  M('void OnCollisionStay(Collision collision)', 'Called once per frame for every Collider or Rigidbody that touches another.'),
  M('void OnCollisionExit(Collision other)', 'Called when this collider/rigidbody has stopped touching another rigidbody/collider.'),
  M('void OnTriggerEnter2D(Collider2D other)', 'Sent when another object enters a trigger collider attached to this object (2D physics only).'),
  M('void OnTriggerStay2D(Collider2D other)', 'Sent each frame where another object is within a trigger collider attached to this object (2D physics only).'),
  M('void OnTriggerExit2D(Collider2D other)', 'Sent when another object leaves a trigger collider attached to this object (2D physics only).'),
  M('void OnCollisionEnter2D(Collision2D collision)', 'Sent when an incoming collider makes contact with this object\'s collider (2D physics only).'),
  M('void OnCollisionStay2D(Collision2D collision)', 'Sent each frame where a collider on another object is touching this object\'s collider (2D physics only).'),
  M('void OnCollisionExit2D(Collision2D collision)', 'Sent when a collider on another object stops touching this object\'s collider (2D physics only).'),
  M('void OnControllerColliderHit(ControllerColliderHit hit)', 'Called when the controller hits a collider while performing a Move.'),
  M('void OnMouseDown()', 'Called when the user has pressed the mouse button while over the Collider.'),
  M('void OnMouseUp()', 'Called when the user has released the mouse button.'),
  M('void OnMouseEnter()', 'Called when the mouse enters the Collider.'),
  M('void OnMouseExit()', 'Called when the mouse is not any longer over the Collider.'),
  M('void OnMouseOver()', 'Called every frame while the mouse is over the Collider.'),
  M('void OnMouseDrag()', 'Called when the user has clicked on a Collider and is still holding down the mouse.'),
  M('void OnBecameVisible()', 'Called when the renderer became visible by any camera.'),
  M('void OnBecameInvisible()', 'Called when the renderer is no longer visible by any camera.'),
  M('void OnDrawGizmos()', 'Implement to draw gizmos that are also pickable and always drawn.'),
  M('void OnDrawGizmosSelected()', 'Implement to draw gizmos if the object is selected.'),
  M('void OnGUI()', 'Called for rendering and handling GUI events (IMGUI).'),
  M('void OnAnimatorMove()', 'Callback for processing animation movements for modifying root motion.'),
  M('void OnAnimatorIK(int layerIndex)', 'Callback for setting up animation IK (inverse kinematics).'),
  M('void OnParticleCollision(GameObject other)', 'Called when a particle hits a Collider.'),
  M('void OnTransformParentChanged()', 'Called when the parent property of the transform of the GameObject has changed.'),
  M('void OnTransformChildrenChanged()', 'Called when the list of children of the transform of the GameObject has changed.'),
  M('void OnRenderObject()', 'Called after camera has rendered the scene.'),
  M('void OnWillRenderObject()', 'Called for each camera if the object is visible and not a UI element.'),
  M('void OnPreRender()', 'Called before a camera starts rendering the scene (built-in pipeline).'),
  M('void OnPostRender()', 'Called after a camera finished rendering the scene (built-in pipeline).'),
  M('void OnRenderImage(RenderTexture source, RenderTexture destination)', 'Called after all rendering is complete to render image (built-in pipeline).'),
  M('void OnRectTransformDimensionsChange()', 'Called when the dimensions of the RectTransform change.'),
  M('void OnCanvasGroupChanged()', 'Called when the state of the parent CanvasGroup changes.'),
  M('void OnJointBreak(float breakForce)', 'Called when a joint attached to the same game object broke.'),
  M('void OnServerInitialized()', 'Called on the server whenever a Network.InitializeServer was invoked and has completed.')
]

export const UNITY_MESSAGE_MAP = new Map(UNITY_MESSAGES.map(m => [m.name, m]))

/** Classes whose subclasses receive Unity messages. */
export const UNITY_BEHAVIOUR_BASES = new Set([
  'MonoBehaviour', 'NetworkBehaviour', 'StateMachineBehaviour', 'ScriptableObject', 'Editor', 'EditorWindow',
  'UIBehaviour', 'Selectable', 'Graphic', 'MaskableGraphic', 'BaseRaycaster', 'BaseInputModule', 'NetworkBehaviourBase'
])

/** Namespaces that hint a type lives in Unity / .NET rather than the project. */
export const EXTERNAL_NAMESPACES = ['UnityEngine', 'UnityEditor', 'System', 'TMPro', 'Unity', 'Cinemachine']

export const unityDocsUrl = (name: string) => `https://docs.unity3d.com/ScriptReference/30_search.html?q=${encodeURIComponent(name)}`
