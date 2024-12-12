import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { DynamicEscrow } from "../target/types/dynamic_escrow";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { randomBytes } from "crypto";

function getTwoRandomValues(list: string[]): [PublicKey, PublicKey] {
  if (list.length < 2) {
    throw new Error("The list must contain at least two elements.");
  }

  const firstIndex = Math.floor(Math.random() * list.length);

  // Generate a second index that is different from the first one
  let secondIndex: number;
  do {
    secondIndex = Math.floor(Math.random() * list.length);
  } while (secondIndex === firstIndex);

  return [new PublicKey(list[firstIndex]), new PublicKey(list[secondIndex])];
}

describe("dynamic-escrow", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const connection = provider.connection;
  const program = anchor.workspace.DynamicEscrow as Program<DynamicEscrow>;

  const mintList=[
    'H227ZpbyurQKWWJHLT2tUXXSv3XDPQcPSmw7mXmFXNtb',
    'HZc9JcGvZkotZF4TeQUc2wzzmXbGXGPHxQ2gRKa1dmSZ',
    'APvZRVDG7PSpjQr1tps7SsXQgeniSJJSwV27XnUVYbQQ'
  ];
  const [mintA, mintB]=getTwoRandomValues(mintList);
  const [initializer, taker] = Array.from({ length: 2 }, () => Keypair.generate());
  const [initializerAtaA, initializerAtaB, takerAtaA, takerAtaB, providerAtaA, providerAtaB] = [initializer, taker, provider]
  .map((a) => [mintA, mintB].map((m) => getAssociatedTokenAddressSync(m, a.publicKey)))
  .flat();

    // Determined Escrow and Vault addresses
    const seed = new anchor.BN(randomBytes(8));
    const escrow = PublicKey.findProgramAddressSync(
      [Buffer.from("state"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
    const vault = getAssociatedTokenAddressSync(mintA, escrow, true);

      // 2. Utils
  // Account Wrapper
  const accounts = {
    initializer: initializer.publicKey,
    taker: taker.publicKey,
    mintA: mintA,
    mintB: mintB,
    initializerAtaA: initializerAtaA,
    initializerAtaB: initializerAtaB,
    takerAtaA,
    takerAtaB,
    escrow,
    vault,
    associatedTokenprogram: ASSOCIATED_TOKEN_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };

  const confirm = async (signature: string): Promise<string> => {
    const block = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      ...block,
    });
    return signature;
  };

  const log = async (signature: string): Promise<string> => {
    console.log(
      `Your transaction signature: https://explorer.solana.com/transaction/${signature}??cluster=devnet`
    );
    return signature;
  };

  it("Airdrop and send tokens", async () => {
    let lamports = await getMinimumBalanceForRentExemptMint(connection);
    let tx = new Transaction();
    tx.instructions = [
      ...[initializer, taker].map((k) =>
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          toPubkey: k.publicKey,
          lamports: 0.01 * LAMPORTS_PER_SOL,
        })
      ),
      ...[
        [mintA, initializer.publicKey, initializerAtaA, providerAtaA],
        [mintB, taker.publicKey, takerAtaB, providerAtaB],
      ].flatMap((x) => [
        createAssociatedTokenAccountIdempotentInstruction(provider.publicKey, x[2], x[1], x[0]),
        createTransferInstruction(  
          x[3], // Source (provider's associated token account)  
          x[2],    // Destination (initializer's associated token account for mintA)  
          provider.publicKey, // Signer  
          1e6        // Token amount (in smallest units of the token, e.g., 1000 = 0.001 if decimals = 3)  
        ) 
      ]),
    ];
    try {
      await provider.sendAndConfirm(tx, []).then(log);
    } catch (error) {
      console.error('Transaction failed:', error);
    }
  });
  it("Initialize", async () => {
    const initializerAmount = 1e6;
    const takerAmount = 1e6;
    await program.methods
      .initialize(seed, new anchor.BN(initializerAmount), new anchor.BN(takerAmount))
      .accounts({ ...accounts })
      .signers([initializer])
      .rpc()
      .then(confirm)
      .then(log);
  });
  xit("Cancel", async () => {
    await program.methods
      .cancel()
      .accounts({ ...accounts })
      .signers([initializer])
      .rpc()
      .then(confirm)
      .then(log);
  });

  it("Exchange", async () => {
    await program.methods
      .exchange()
      .accounts({ ...accounts })
      .signers([taker])
      .rpc()
      .then(confirm)
      .then(log);
  });
});
