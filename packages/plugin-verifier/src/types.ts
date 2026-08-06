/**
 * Plugin Verifier Types
 *
 * TICKET_098: Plugin Signature & Verification
 * TICKET_099: Permission Declaration Schema
 */

// =============================================================================
// Trust Levels
// =============================================================================

export type TrustLevel =
  | 'official'     // L1: Signed by StratCraft root CA
  | 'verified'     // L2: Signed by Market-verified publisher
  | 'unverified'   // L3: Self-signed by publisher (warning shown)
  | 'unsigned';    // L4: No signature (requires dev mode)

// =============================================================================
// Signature Metadata (SIGNATURE.json)
// =============================================================================

export interface SignatureMetadata {
  algorithm: 'Ed25519';
  signed_files: SignedFile[];
  timestamp: string;
  publisher: PublisherInfo;
}

export interface SignedFile {
  path: string;
  sha256: string;
}

export interface PublisherInfo {
  id: string;           // e.g., "com.StratCraft"
  name: string;         // e.g., "StratCraft Official"
  certificate: string;  // PEM-encoded certificate
}

// =============================================================================
// Certificate Structure
// =============================================================================

export interface PublisherCertificate {
  version: number;
  serial: string;
  issuer: string;          // "StratCraft Root CA" or parent publisher
  subject: string;         // Publisher ID
  publicKey: string;       // Base64-encoded Ed25519 public key
  notBefore: string;       // ISO timestamp
  notAfter: string;        // ISO timestamp
  signature: string;       // Issuer's signature over certificate
}

// =============================================================================
// Verification Results
// =============================================================================

export interface VerificationResult {
  valid: boolean;
  trustLevel: TrustLevel;
  publisher?: PublisherInfo;
  errors: string[];
  warnings: string[];
}

export interface FileVerificationResult {
  path: string;
  expected: string;
  actual: string;
  valid: boolean;
}

// =============================================================================
// Permission Schema (TICKET_099)
// =============================================================================

export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PluginPermissions {
  network?: NetworkPermission;
  fs?: FileSystemPermission;
  bridge?: BridgePermission;
  secrets?: SecretsPermission;
  shell?: ShellPermission;
  native?: NativePermission;
}

export interface NetworkPermission {
  hosts: string[];      // Allowed hostnames (supports wildcards like *.example.com)
  reason: string;       // User-visible explanation
}

export interface FileSystemPermission {
  read?: string[];      // Paths with $variables and globs
  write?: string[];
  reason: string;
}

export type BridgeApiName =
  | 'DataChannel'
  | 'SessionApi'
  | 'Registry'
  | 'EventBus'
  | '*';

export interface BridgePermission {
  apis: BridgeApiName[];
  reason: string;
}

export interface SecretsPermission {
  keys: string[];       // Allowed secret key names
  reason: string;
}

export interface ShellPermission {
  commands: string[];   // Allowed executables
  args?: string[];      // Allowed argument patterns
  reason: string;
}

export interface NativePermission {
  modules: string[];    // N-API addon names
  reason: string;
}

// =============================================================================
// Permission Validation Results
// =============================================================================

export interface PermissionValidationResult {
  valid: boolean;
  riskLevel: PermissionRiskLevel;
  errors: string[];
  warnings: string[];
  permissions: ParsedPermission[];
}

export interface ParsedPermission {
  type: keyof PluginPermissions;
  riskLevel: PermissionRiskLevel;
  description: string;
  reason: string;
}

// =============================================================================
// Installation Preview
// =============================================================================

export interface InstallPreview {
  pluginId: string;
  version: string;
  displayName: string;
  publisher: PublisherInfo | null;
  trustLevel: TrustLevel;
  permissions: ParsedPermission[];
  warnings: string[];
  requiresDevMode: boolean;
  existingVersion?: string;
}

// =============================================================================
// Granted Permissions Storage
// =============================================================================

export interface GrantedPermissionsRecord {
  [pluginId: string]: GrantedPluginPermissions;
}

export interface GrantedPluginPermissions {
  version: string;
  grantedAt: string;
  permissions: PluginPermissions;
  revokedPermissions?: string[];
}
