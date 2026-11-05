/**
 * The interface strings, in the language the reader picked.
 *
 * The messages come from `web/data/i18n.json`, which is the only source.  The
 * module keeps them so the renderers can call `t()` without threading a state
 * object through every call; `app.js` fills them at boot and on a language
 * change with `setMessages()`.
 */

let messages = {};

/** Install the message table for one language; `{}` keeps the keys visible. */
export function setMessages(value) {
  messages = value ?? {};
}

/** Look up one key and fill `{name}` placeholders from `vars`. */
export function t(key, vars) {
  let text = messages[key] ?? key;
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value);
  return text;
}
