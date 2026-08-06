/**
 * Signature Verifier
 *
 * TICKET_098: Plugin Signature & Verification
 * Ed25519 signature verification for plugin packages
 */

import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import * as crypto from 'crypto';
import type {
  SignatureMetadata,
  PublisherInfo,
  PublisherCertificate,
  VerificationResult,
  FileVerificationResult,
  TrustLevel,
} from './types';

// =============================================================================
// Root CA Public Key (Embedded in app binary)
// =============================================================================

// StratCraft Root CA Ed25519 Public Key (Base64)
// In production, this would be embedded during build
const StratCraft_ROOT_CA_PUBLIC_KEY = process.env.StratCraft_ROOT_CA_KEY || '';

// Official publisher prefix
const OFFICIAL_PUBLISHER_PREFIX = 'com.StratCraft';

// =============================================================================
// Signature Verifier Class
// =============================================================================

export class SignatureVerifier {
  private rootCaPublicKey: Uint8Array | null = null;
  private revokedCertificates: Set<string> = new Set();

  constructor(rootCaKey?: string) {
    if (rootCaKey || StratCraft_ROOT_CA_PUBLIC_KEY) {
      try {
        this.rootCaPublicKey = naclUtil.decodeBase64(
          rootCaKey || StratCraft_ROOT_CA_PUBLIC_KEY
        );
      } catch {
        // Root CA not configured - all packages will be unverified
      }
    }
  }

  /**
   * Load revoked certificates from CRL
   */
  loadRevokedCertificates(serials: string[]): void {
    this.revokedCertificates = new Set(serials);
  }

  /**
   * Verify a plugin package signature
   */
  async verifyPackage(
    signatureJson: string,
    signatureBytes: Uint8Array,
    fileContents: Map<string, Buffer>
  ): Promise<VerificationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Parse signature metadata
    let metadata: SignatureMetadata;
    try {
      metadata = JSON.parse(signatureJson);
    } catch {
      return {
        valid: false,
        trustLevel: 'unsigned',
        errors: ['Invalid SIGNATURE.json format'],
        warnings: [],
      };
    }

    // Validate algorithm
    if (metadata.algorithm !== 'Ed25519') {
      return {
        valid: false,
        trustLevel: 'unsigned',
        errors: [`Unsupported algorithm: ${metadata.algorithm}`],
        warnings: [],
      };
    }

    // Parse publisher certificate
    let certificate: PublisherCertificate;
    try {
      certificate = this.parseCertificate(metadata.publisher.certificate);
    } catch (e) {
      return {
        valid: false,
        trustLevel: 'unsigned',
        errors: [`Invalid publisher certificate: ${e}`],
        warnings: [],
      };
    }

    // Check certificate expiration
    const now = new Date();
    const notBefore = new Date(certificate.notBefore);
    const notAfter = new Date(certificate.notAfter);

    if (now < notBefore) {
      errors.push('Certificate not yet valid');
    }
    if (now > notAfter) {
      warnings.push('Publisher certificate has expired');
    }

    // Check revocation
    if (this.revokedCertificates.has(certificate.serial)) {
      return {
        valid: false,
        trustLevel: 'unsigned',
        publisher: metadata.publisher,
        errors: ['Publisher certificate has been revoked'],
        warnings: [],
      };
    }

    // Verify signature over SIGNATURE.json
    const signatureJsonBytes = new TextEncoder().encode(signatureJson);
    const messageHash = crypto
      .createHash('sha256')
      .update(signatureJsonBytes)
      .digest();

    const publicKey = naclUtil.decodeBase64(certificate.publicKey);
    const signatureValid = nacl.sign.detached.verify(
      new Uint8Array(messageHash),
      signatureBytes,
      publicKey
    );

    if (!signatureValid) {
      return {
        valid: false,
        trustLevel: 'unsigned',
        publisher: metadata.publisher,
        errors: ['Signature verification failed'],
        warnings: [],
      };
    }

    // Verify file integrity
    const fileResults = this.verifyFiles(metadata.signed_files, fileContents);
    const invalidFiles = fileResults.filter(r => !r.valid);

    if (invalidFiles.length > 0) {
      return {
        valid: false,
        trustLevel: 'unsigned',
        publisher: metadata.publisher,
        errors: invalidFiles.map(
          f => `File integrity check failed: ${f.path}`
        ),
        warnings: [],
      };
    }

    // Determine trust level
    const trustLevel = this.determineTrustLevel(certificate, metadata.publisher);

    return {
      valid: errors.length === 0,
      trustLevel,
      publisher: metadata.publisher,
      errors,
      warnings,
    };
  }

  /**
   * Verify individual file checksums
   */
  private verifyFiles(
    signedFiles: SignatureMetadata['signed_files'],
    fileContents: Map<string, Buffer>
  ): FileVerificationResult[] {
    const results: FileVerificationResult[] = [];

    for (const signedFile of signedFiles) {
      const content = fileContents.get(signedFile.path);

      if (!content) {
        results.push({
          path: signedFile.path,
          expected: signedFile.sha256,
          actual: '',
          valid: false,
        });
        continue;
      }

      const actualHash = crypto
        .createHash('sha256')
        .update(content)
        .digest('hex');

      results.push({
        path: signedFile.path,
        expected: signedFile.sha256,
        actual: actualHash,
        valid: actualHash === signedFile.sha256,
      });
    }

    return results;
  }

  /**
   * Parse PEM certificate
   */
  private parseCertificate(pem: string): PublisherCertificate {
    // Extract base64 content between headers
    const lines = pem.trim().split('\n');
    const base64Lines = lines.filter(
      line =>
        !line.startsWith('-----BEGIN') && !line.startsWith('-----END')
    );
    const base64 = base64Lines.join('');
    const json = Buffer.from(base64, 'base64').toString('utf-8');
    return JSON.parse(json);
  }

  /**
   * Determine trust level based on certificate chain
   */
  private determineTrustLevel(
    certificate: PublisherCertificate,
    publisher: PublisherInfo
  ): TrustLevel {
    // Check if official publisher
    if (publisher.id.startsWith(OFFICIAL_PUBLISHER_PREFIX)) {
      // Verify certificate is signed by root CA
      if (this.verifyCertificateChain(certificate)) {
        return 'official';
      }
    }

    // Check if certificate is signed by root CA (verified third-party)
    if (this.verifyCertificateChain(certificate)) {
      return 'verified';
    }

    // Self-signed certificate
    return 'unverified';
  }

  /**
   * Verify certificate chain to root CA
   */
  private verifyCertificateChain(certificate: PublisherCertificate): boolean {
    if (!this.rootCaPublicKey) {
      return false;
    }

    try {
      // Build message that was signed (certificate without signature)
      const certCopy = { ...certificate };
      delete (certCopy as Record<string, unknown>)['signature'];
      const certJson = JSON.stringify(certCopy);
      const certBytes = new TextEncoder().encode(certJson);
      const certHash = crypto.createHash('sha256').update(certBytes).digest();

      // Verify with root CA public key
      const signature = naclUtil.decodeBase64(certificate.signature);
      return nacl.sign.detached.verify(
        new Uint8Array(certHash),
        signature,
        this.rootCaPublicKey
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if package is unsigned
   */
  isUnsigned(
    signatureJson: string | null,
    signatureBytes: Uint8Array | null
  ): boolean {
    return !signatureJson || !signatureBytes || signatureBytes.length === 0;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate SHA-256 hash of file content
 */
export function calculateSha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generate Ed25519 keypair for signing
 */
export function generateKeyPair(): {
  publicKey: string;
  secretKey: string;
} {
  const keyPair = nacl.sign.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(keyPair.publicKey),
    secretKey: naclUtil.encodeBase64(keyPair.secretKey),
  };
}

/**
 * Sign data with Ed25519 secret key
 */
export function signData(data: Uint8Array, secretKey: string): string {
  const key = naclUtil.decodeBase64(secretKey);
  const signature = nacl.sign.detached(data, key);
  return naclUtil.encodeBase64(signature);
}

// =============================================================================
// Export singleton
// =============================================================================

let defaultVerifier: SignatureVerifier | null = null;

export function getSignatureVerifier(): SignatureVerifier {
  if (!defaultVerifier) {
    defaultVerifier = new SignatureVerifier();
  }
  return defaultVerifier;
}
