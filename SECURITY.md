# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of StratCraft seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**DO NOT** create a public GitHub issue for security vulnerabilities.

Instead, please send an email to: **security@StratCraftsAI.tech**

Include the following information:
- Type of vulnerability (e.g., XSS, SQL injection, buffer overflow)
- Location of the affected source code (file path, line numbers)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact assessment

### What to Expect

1. **Acknowledgment**: We will acknowledge receipt within 48 hours
2. **Assessment**: We will investigate and assess the vulnerability within 7 days
3. **Resolution**: We will work on a fix and coordinate disclosure
4. **Credit**: We will credit you in the security advisory (unless you prefer anonymity)

## Scope

The following are **in scope**:
- StratCraft desktop application (Electron main process, renderer, preload)
- C++ Executor engine
- Plugin system and sandbox
- IPC communication
- Credential storage (SecureCredentialService)
- Plugin Marketplace download and verification

The following are **out of scope**:
- Third-party plugins not maintained by StratCraftsAI
- Issues in upstream dependencies (report to upstream maintainers)
- Social engineering attacks

## API Key Handling (BYOK)

StratCraft supports a Bring Your Own Key (BYOK) model for LLM-based strategy generation. Here is our commitment:

### How Your API Key Is Used

1. You enter your API key in the desktop app
2. The key is stored locally using encrypted credential storage (Electron `safeStorage`)
3. When generating a strategy, the key is sent to our server over HTTPS (TLS encrypted)
4. The server uses the key **exclusively** for the LLM inference call
5. The key is **NOT stored** on our server (pass-through only, per-request)
6. Server logs do **NOT** contain API keys

### What We Guarantee

- Your API key is **never persisted** on our servers
- Your API key is **never logged** in server-side logs
- Your API key is transmitted over **HTTPS only** (TLS 1.2+)
- Your API key is used **only** for the specific LLM call you requested

### Local Storage Security

- API keys stored locally via `SecureCredentialService` using Electron `safeStorage`
- `safeStorage` uses OS-level encryption (DPAPI on Windows, Keychain on macOS, libsecret on Linux)
- Keys are never written to plain-text files or SQLite databases

## Security Architecture

StratCraft implements defense-in-depth:

| Layer | Protection |
|-------|-----------|
| **Context Isolation** | Renderer has zero access to Node.js APIs |
| **Sandbox Mode** | Enabled by default for all renderer processes |
| **CSP Headers** | Content Security Policy prevents XSS and injection |
| **Preload Bridge** | All IPC goes through `contextBridge.exposeInMainWorld()` |
| **Credential Encryption** | OS-level `safeStorage` for all secrets |
| **Plugin Permissions** | Granular permission declaration in plugin manifests |
| **Plugin Verification** | SHA256 checksum verification on marketplace downloads |
| **Input Validation** | IPC handlers validate all inputs from renderer |

## Acknowledgments

We thank the following security researchers for responsibly disclosing vulnerabilities:

- (No reports yet)
