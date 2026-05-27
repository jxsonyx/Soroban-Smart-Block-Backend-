import { xdr, StrKey } from '@stellar/stellar-sdk';

export interface AuthSnapshot {
  /** Base64 XDR of the SorobanAuthorizationEntry — the exact bytes to sign */
  entryXdr: string;
  /** Signer address (account or contract) */
  signerAddress: string;
  /** Nonce that must be used in the signature */
  nonce: string | null;
  /** Contract being authorized */
  contractId: string;
  /** Function being authorized */
  functionName: string;
  /** Ready-to-paste JS snippet using @stellar/stellar-sdk */
  jsSnippet: string;
  /** Ready-to-paste Rust snippet using soroban-sdk */
  rustSnippet: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scAddressToString(addr: xdr.ScAddress): string {
  return addr.switch().name === 'scAddressTypeAccount'
    ? StrKey.encodeEd25519PublicKey(addr.accountId().ed25519())
    : StrKey.encodeContract(addr.contractId());
}

function buildJsSnippet(
  entryXdr: string,
  signerAddress: string,
  nonce: string | null,
  contractId: string,
  functionName: string
): string {
  return `\
// ── Auth snippet (JS / @stellar/stellar-sdk) ──────────────────────────────
// Signer : ${signerAddress}
// Contract: ${contractId}  fn: ${functionName}
import { xdr, Keypair, hash } from '@stellar/stellar-sdk';

const entry = xdr.SorobanAuthorizationEntry.fromXDR('${entryXdr}', 'base64');

// Set the expiration ledger before signing (replace CURRENT_LEDGER)
entry.credentials().address().signatureExpirationLedger(CURRENT_LEDGER + 100);

// Sign with the authorizing keypair
const keypair = Keypair.fromSecret('YOUR_SECRET_KEY'); // signer: ${signerAddress}
const preimage = xdr.HashIdPreimage.fromXDR(
  xdr.HashIdPreimageSorobanAuthorization.toXDR(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
      nonce: entry.credentials().address().nonce(),${nonce !== null ? `  // nonce: ${nonce}` : ''}
      signatureExpirationLedger: entry.credentials().address().signatureExpirationLedger(),
      invocation: entry.rootInvocation(),
    })
  )
);
const sig = keypair.sign(hash(preimage));
entry.credentials().address().signature(
  xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('public_key'), val: xdr.ScVal.scvBytes(keypair.rawPublicKey()) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signature'),  val: xdr.ScVal.scvBytes(sig) }),
  ])
);

// Attach to your transaction's auth array
op.body().invokeHostFunctionOp().auth([entry]);`;
}

function buildRustSnippet(
  entryXdr: string,
  signerAddress: string,
  nonce: string | null,
  contractId: string,
  functionName: string
): string {
  return `\
// ── Auth snippet (Rust / soroban-sdk) ────────────────────────────────────
// Signer : ${signerAddress}
// Contract: ${contractId}  fn: ${functionName}
use soroban_sdk::{xdr::SorobanAuthorizationEntry, Env};

let entry_xdr = "${entryXdr}";
let mut entry = SorobanAuthorizationEntry::from_xdr_base64(entry_xdr, Limits::none())
    .expect("valid auth entry");

// Set expiration (replace current_ledger with your ledger value)
if let soroban_sdk::xdr::SorobanCredentials::Address(ref mut creds) = entry.credentials {
    creds.signature_expiration_ledger = current_ledger + 100;${nonce !== null ? `\n    // nonce: ${nonce}` : ''}
    // Build preimage and sign
    let preimage = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
        network_id: Hash(env.ledger().network_id().to_array()),
        nonce: creds.nonce,
        signature_expiration_ledger: creds.signature_expiration_ledger,
        invocation: entry.root_invocation.clone(),
    });
    let payload = Sha256::digest(preimage.to_xdr(Limits::none()).unwrap());
    let sig = signing_keypair.sign(&payload); // signer: ${signerAddress}
    creds.signature = ScVal::Map(Some(ScMap(vec![
        ScMapEntry { key: ScVal::Symbol("public_key".into()), val: ScVal::Bytes(signing_keypair.public.to_bytes().to_vec().try_into().unwrap()) },
        ScMapEntry { key: ScVal::Symbol("signature".into()),  val: ScVal::Bytes(sig.to_bytes().to_vec().try_into().unwrap()) },
    ].try_into().unwrap())));
}
// Pass entry to invoke_contract auth parameter`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Convert an array of SorobanAuthorizationEntry XDR objects (returned by
 * simulateTransaction result.auth) into AuthSnapshot records containing
 * the exact XDR bytes plus copy-paste JS and Rust signing snippets.
 */
export function generateAuthSnapshots(
  authEntries: xdr.SorobanAuthorizationEntry[]
): AuthSnapshot[] {
  return authEntries.map((entry) => {
    const entryXdr = entry.toXDR('base64');
    const credentials = entry.credentials();
    const credSwitch = credentials.switch().name;

    let signerAddress = 'source'; // sorobanCredentialsSourceAccount
    let nonce: string | null = null;

    if (credSwitch === 'sorobanCredentialsAddress') {
      const addrCreds = credentials.address();
      signerAddress = scAddressToString(addrCreds.address());
      nonce = addrCreds.nonce().toString();
    }

    // Extract contract + function from root invocation
    const rootFn = entry.rootInvocation().function();
    let contractId = 'unknown';
    let functionName = 'unknown';
    if (rootFn.switch().name === 'sorobanAuthorizedFunctionTypeContractFn') {
      const cf = rootFn.contractFn();
      contractId = StrKey.encodeContract(cf.contractAddress().contractId());
      functionName = cf.functionName().toString();
    }

    return {
      entryXdr,
      signerAddress,
      nonce,
      contractId,
      functionName,
      jsSnippet: buildJsSnippet(entryXdr, signerAddress, nonce, contractId, functionName),
      rustSnippet: buildRustSnippet(entryXdr, signerAddress, nonce, contractId, functionName),
    };
  });
}
