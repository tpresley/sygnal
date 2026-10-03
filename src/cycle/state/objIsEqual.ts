/** Structural equality (to depth 5): the core's state/props/context diffing and STATE.watch (GS-6) */
export function objIsEqual(obj1: any, obj2?: any, maxDepth: number = 5, depth: number = 0): boolean {
  // Past maxDepth the values count as different (false): the caller then treats them as changed
  if (depth > maxDepth) {
      return false;
  }

  // If both are the same object or are both exactly null or undefined
  if (obj1 === obj2) {
      return true;
  }

  // If either is not an object (null, undefined, or primitive), directly compare
  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
      return false;
  }

  // Special handling for arrays
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) {
        return false;
    }
    for (let i = 0; i < obj1.length; i++) {
        if (!objIsEqual(obj1[i], obj2[i], maxDepth, depth + 1)) {
            return false;
        }
    }
    return true;
  }

  // Get keys of both objects
  const keys1 = Object.keys(obj1);

  // Check if the number of properties is different
  if (keys1.length !== Object.keys(obj2).length) {
      return false;
  }

  // Recursively check each property
  for (const key of keys1) {
      if (!(key in obj2)) {
          return false;
      }
      if (!objIsEqual(obj1[key], obj2[key], maxDepth, depth + 1)) {
          return false;
      }
  }

  return true;
}
