function getAppFromPath(p) {
  const parts = p.split('\\');
  return parts[parts.length - 1].toLowerCase();
}

function isWindowMatchRule(w, rule) {
  let isMatch = false;
  const testField = (winField, regex) => {
    if (!regex) return false;
    const reg = new RegExp(regex, 'i');
    return reg.test(w[winField]);
  };
  if (rule.titleMatch) {
    isMatch = testField('title', rule.titleMatch);
    if (!isMatch) return false;
  }
  if (rule.pathMatch) {
    isMatch = testField('path', rule.pathMatch);
  }
  if (isMatch && rule.exclude) {
    if (testField('title', rule.exclude?.titleMatch)) isMatch = false;
    if (isMatch && testField('path', rule.exclude?.pathMatch)) isMatch = false;
  }
  return isMatch;
}

export { getAppFromPath, isWindowMatchRule };
