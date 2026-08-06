# Credential API Developer Guide

This guide explains how to securely manage credentials in StratCraft plugins.

---

## Overview

The StratCraft Credential API provides secure storage for sensitive data like API keys, passwords, and tokens. All credentials are:

- **Encrypted** with AES-256-GCM
- **Isolated** per plugin (namespace separation)
- **Stored** in system keychain (macOS/Windows/Linux) or encrypted file

---

## Protection Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| **Standard** | Plugin can read the decrypted value | Database passwords, API keys |
| **High** | Value never leaves C++ Core | Trading private keys, signing keys |

---

## TypeScript Plugin API

### Basic Usage

```typescript
import { PluginContext } from '@StratCraft/plugin-sdk';

class MyPlugin extends BasePlugin {
  async activate(context: PluginContext): Promise<void> {
    // Get a credential
    const apiKey = await context.credentials.getSecret(this.id, 'API_KEY');
    if (!apiKey) {
      throw new Error('API_KEY not configured');
    }

    // Set a credential
    await context.credentials.setSecret(this.id, 'API_KEY', 'sk-xxx');

    // Check if credential exists
    const hasKey = await context.credentials.hasSecret(this.id, 'API_KEY');

    // List all keys
    const keys = await context.credentials.listKeys(this.id);

    // Delete a credential
    await context.credentials.deleteSecret(this.id, 'API_KEY');
  }
}
```

### Register Credential Configuration

Register credential metadata during plugin initialization:

```typescript
async activate(context: PluginContext): Promise<void> {
  // Register credential with UI metadata
  await context.credentials.registerCredential(this.id, {
    key: 'CLICKHOUSE_PASSWORD',
    label: 'ClickHouse Password',
    description: 'Database password for market data access',
    protection: 'standard',
    sensitivity: 'secret',
    pattern: '^.{8,}$',           // Optional: validation regex
    patternError: 'Password must be at least 8 characters'
  });
}
```

### High Protection Credentials

For credentials that should never leave the secure environment:

```typescript
async signOrder(order: Order): Promise<string> {
  // Private key is decrypted in C++ Core, used, and cleared
  // The result (signature) is returned, NOT the key
  const result = await context.credentials.executeWithCredential(
    this.id,
    'TRADING_PRIVATE_KEY',
    'sign',                     // Pre-registered operation
    JSON.stringify({ message: order.hash() })
  );

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;  // This is the signature
}
```

### Electron Renderer (UI)

The Credential API is available in the Electron renderer process:

```typescript
// In React component
const apiKey = await window.electronAPI.credential.get('my-plugin', 'API_KEY');

// Set credential
await window.electronAPI.credential.set('my-plugin', 'API_KEY', value);

// Check existence
const result = await window.electronAPI.credential.has('my-plugin', 'API_KEY');

// List keys
const keysResult = await window.electronAPI.credential.list('my-plugin');

// Delete
await window.electronAPI.credential.delete('my-plugin', 'API_KEY');

// Master password
await window.electronAPI.credential.setMasterPassword('user-password');
const session = await window.electronAPI.credential.validateUser('user-password');

// Audit log
const logs = await window.electronAPI.credential.getAuditLog('my-plugin', 10);
```

---

## Python Plugin API

### Basic Usage

```python
from StratCraft.plugin import BasePlugin, PluginContext

class MyPlugin(BasePlugin):
    async def activate(self, context: PluginContext) -> None:
        # Get a credential
        password = await context.credential.get('DB_PASSWORD')
        if not password:
            raise ConfigurationError('DB_PASSWORD not configured')

        # Set a credential
        await context.credential.set('DB_PASSWORD', 'secret123')

        # Check if credential exists
        exists = await context.credential.exists('DB_PASSWORD')

        # List all keys
        keys = await context.credential.list_keys()

        # Delete a credential
        await context.credential.delete('DB_PASSWORD')
```

### API Reference

```python
class CredentialAPI:
    async def get(self, key: str) -> Optional[str]:
        """
        Get a credential value.
        Returns None if not found.
        """

    async def set(self, key: str, value: str) -> bool:
        """
        Set a credential value.
        Returns True on success.
        """

    async def delete(self, key: str) -> bool:
        """
        Delete a credential.
        Returns True on success.
        """

    async def exists(self, key: str) -> bool:
        """
        Check if a credential exists.
        """

    async def list_keys(self) -> list[str]:
        """
        List all credential keys for this plugin.
        """
```

### Example: ClickHouse Connection

```python
class DataPlugin(BasePlugin):
    async def activate(self, context: PluginContext) -> None:
        # Get credentials
        host = await context.credential.get('CLICKHOUSE_HOST') or 'localhost'
        port = await context.credential.get('CLICKHOUSE_PORT') or '9000'
        password = await context.credential.get('CLICKHOUSE_PASSWORD')

        if not password:
            self.logger.warning('CLICKHOUSE_PASSWORD not set, using empty password')
            password = ''

        # Connect
        self.client = clickhouse_connect.get_client(
            host=host,
            port=int(port),
            password=password
        )
```

---

## C++ Plugin API

### Using gRPC Client

```cpp
#include "credential/secure_credential_manager.hpp"

class MyPlugin : public IPlugin {
public:
    void activate(PluginContext& context) override {
        auto& cred_manager = context.credential_manager();

        // Get credential
        auto result = cred_manager.get_secret(id_, "API_KEY");
        if (!result.has_value()) {
            throw std::runtime_error("API_KEY not configured");
        }
        std::string api_key = *result;

        // Set credential
        cred_manager.set_secret(id_, "API_KEY", "sk-xxx");

        // Check existence
        bool exists = cred_manager.has_credential(id_, "API_KEY");

        // List keys
        auto keys = cred_manager.list_keys(id_);

        // Delete
        cred_manager.delete_secret(id_, "API_KEY");
    }
};
```

### High Protection with Operations

```cpp
// Register an operation handler
cred_manager.register_operation("sign", [](const SecureBuffer& key, std::string_view params) {
    // key contains the decrypted credential
    // params contains JSON parameters

    auto signature = crypto::sign(params, key);

    return OperationResult{
        .success = true,
        .data = signature,
        .error = ""
    };
});

// Execute with High Protection credential
auto result = cred_manager.execute_with_credential(
    plugin_id,
    "PRIVATE_KEY",
    "sign",
    R"({"message": "data to sign"})"
);
```

---

## Best Practices

### 1. Always Handle Missing Credentials

```typescript
const apiKey = await context.credentials.getSecret(this.id, 'API_KEY');
if (!apiKey) {
  // Option 1: Throw error
  throw new ConfigurationError('API_KEY is required');

  // Option 2: Use default (if appropriate)
  apiKey = 'default-value';

  // Option 3: Disable feature
  this.apiEnabled = false;
}
```

### 2. Register Credentials with Metadata

```typescript
// Good: Provides UI hints and validation
await context.credentials.registerCredential(this.id, {
  key: 'API_KEY',
  label: 'API Key',
  description: 'Your API key from https://example.com/settings',
  pattern: '^sk-[a-zA-Z0-9]{32}$',
  patternError: 'API key must start with "sk-" followed by 32 characters'
});

// Bad: No metadata for settings UI
await context.credentials.setSecret(this.id, 'API_KEY', value);
```

### 3. Use High Protection for Critical Credentials

```typescript
// For trading keys, use High Protection
await context.credentials.registerCredential(this.id, {
  key: 'TRADING_PRIVATE_KEY',
  protection: 'high',        // Key never leaves C++ Core
  sensitivity: 'critical'    // Requires user notification on use
});

// Access via executeWithCredential, NOT getSecret
const signature = await context.credentials.executeWithCredential(
  this.id, 'TRADING_PRIVATE_KEY', 'sign', params
);
```

### 4. Clear Sensitive Data After Use

```typescript
let password = await context.credentials.getSecret(this.id, 'PASSWORD');
try {
  await this.connect(password);
} finally {
  // Clear the password from memory (if possible)
  password = '';
}
```

### 5. Use Meaningful Key Names

```typescript
// Good: Clear and descriptive
'CLICKHOUSE_PASSWORD'
'BINANCE_API_KEY'
'TRADING_PRIVATE_KEY'

// Bad: Unclear
'PWD'
'KEY1'
'SECRET'
```

---

## Error Handling

### Error Codes

| Code | Meaning |
|------|---------|
| `NotFound` | Credential does not exist |
| `AccessDenied` | Plugin does not have permission |
| `InvalidProtectionLevel` | Trying to getSecret on High Protection credential |
| `ValidationFailed` | Master password validation failed |
| `EncryptionFailed` | Encryption operation failed |
| `StorageError` | Backend storage error |

### TypeScript Error Handling

```typescript
const result = await window.electronAPI.credential.get('plugin', 'KEY');
if (!result.success) {
  switch (result.errorCode) {
    case 1: // NotFound
      console.log('Credential not configured');
      break;
    case 2: // AccessDenied
      console.log('Permission denied');
      break;
    default:
      console.error(result.errorMessage);
  }
}
```

---

## Security Considerations

1. **Never log credentials** - Avoid logging credential values
2. **Minimize exposure** - Get credentials only when needed
3. **Use High Protection** - For signing keys and other critical secrets
4. **Validate input** - Use `pattern` to validate credential format
5. **Clear after use** - Zero out credential values when done

---

## See Also

- [Credential Security Redesign](../design/_CREDENTIAL_SECURITY_REDESIGN.md)
- [SecureStorage Service](../design/_SECURE_STORAGE_SERVICE.md)
- [Plugin Architecture](../_NEXUS_PLUGIN_ARCHITECTURE.md)

---

**Last Updated**: 2026-01-04
