// sygnal comes from this repository (file:../..): Metro follows the symlink and watches the repo.
// react and react-native always resolve from this app (sygnal/react-native, under the repo root,
// would otherwise find the repo's own React: two Reacts, and hooks fail)
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)
const root = path.resolve(__dirname, '../..')
const here = path.join(__dirname, 'index.js')
config.watchFolders = [root]
config.resolver.unstable_enablePackageExports = true
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pinned = /^(react|react-native)(\/|$)/.test(moduleName)
  return context.resolveRequest(pinned ? { ...context, originModulePath: here } : context, moduleName, platform)
}
module.exports = config
