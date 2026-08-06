/**
 * @StratCraft/plugin-verifier
 *
 * Plugin signature verification and permission validation
 *
 * TICKET_098: Plugin Signature & Verification
 * TICKET_099: Permission Declaration Schema
 */

// Types
export type {
  TrustLevel,
  SignatureMetadata,
  SignedFile,
  PublisherInfo,
  PublisherCertificate,
  VerificationResult,
  FileVerificationResult,
  PermissionRiskLevel,
  PluginPermissions,
  NetworkPermission,
  FileSystemPermission,
  BridgeApiName,
  BridgePermission,
  SecretsPermission,
  ShellPermission,
  NativePermission,
  PermissionValidationResult,
  ParsedPermission,
  InstallPreview,
  GrantedPermissionsRecord,
  GrantedPluginPermissions,
} from './types';

// Signature Verifier
export {
  SignatureVerifier,
  getSignatureVerifier,
  calculateSha256,
  generateKeyPair,
  signData,
} from './signature-verifier';

// Permission Validator
export {
  PermissionValidator,
  getPermissionValidator,
  resolvePath,
  matchPathPattern,
  matchHostPattern,
  type PathVariables,
} from './permission-validator';
