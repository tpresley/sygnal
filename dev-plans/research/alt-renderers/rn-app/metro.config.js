// sygnal comes from this repository (file:../../../..): Metro follows the symlink and watches the
// repo root, and resolves react / react-native from this app only (one copy of each)
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)
const root = path.resolve(__dirname, '../../../..')
config.watchFolders = [root]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(root, 'node_modules')]
config.resolver.disableHierarchicalLookup = true
config.resolver.unstable_enablePackageExports = true
module.exports = config
