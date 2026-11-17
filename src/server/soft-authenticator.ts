import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

/**
 * For tests only: a software authenticator — enough WebAuthn to make and use
 * a real ES256 passkey — so whole ceremonies run through SimpleWebAuthn's
 * verification. From MoneyRight's passkey tests.
 */

const b64url = (b: Uint8Array | string) => Buffer.from(b).toString("base64url");

function cbor(value: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  };
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (value instanceof Map) {
    return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  }
  throw new Error("unsupported");
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly key: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  private counter = 0;
  /** The user handle it was registered with, as a resident key keeps it. */
  userHandle: string | undefined;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.key = privateKey;
    this.publicJwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  }

  private authData(rpId: string, attested: boolean) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(++this.counter);
    // Flags: user present, user verified, and (when making one) attested credential data.
    const parts: Buffer[] = [createHash("sha256").update(rpId).digest(), Buffer.from([0x01 | 0x04 | (attested ? 0x40 : 0)]), counter];
    if (attested) {
      const coseKey = cbor(
        new Map<number, unknown>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(this.publicJwk.x, "base64url")],
          [-3, Buffer.from(this.publicJwk.y, "base64url")],
        ]),
      );
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), len, this.credentialId, coseKey);
    }
    return Buffer.concat(parts);
  }

  register(options: { challenge: string; user?: { id: string } }, rp: { id: string; origin: string }) {
    if (options.user) this.userHandle = Buffer.from(options.user.id, "base64url").toString();
    const clientData = JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: rp.origin, crossOrigin: false });
    const attestationObject = cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", this.authData(rp.id, true)]]));
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key" as const,
      clientExtensionResults: {},
      response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestationObject), transports: ["internal"] },
    } as never;
  }

  authenticate(options: { challenge: string }, rp: { id: string; origin: string }, userHandle = this.userHandle) {
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: rp.origin, crossOrigin: false }));
    const authenticatorData = this.authData(rp.id, false);
    const signature = sign("sha256", Buffer.concat([authenticatorData, createHash("sha256").update(clientData).digest()]), this.key);
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
        ...(userHandle ? { userHandle: b64url(userHandle) } : {}),
      },
    } as never;
  }
}
