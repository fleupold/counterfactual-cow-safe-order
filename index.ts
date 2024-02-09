import { ethers, MaxUint256, ZeroHash, AbiCoder } from "ethers";
import fetch from "node-fetch";
import fuck, {
  EthersAdapter,
  SafeAccountConfig,
  PredictedSafeProps,
} from "@safe-global/protocol-kit";
import dotenv from "dotenv";

import erc20Abi from "./abis/erc20.json" assert { type: "json" };
import multisendAbi from "./abis/multisend.json" assert { type: "json" };
import fallbackHandlerAbi from "./abis/fallbackHandler.json" assert { type: "json" };
import setttlementAbi from "./abis/settlement.json" assert { type: "json" };
import composableCoWAbi from "./abis/composableCow.json" assert { type: "json" };

const Safe = (fuck as any).default;

dotenv.config();
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const ownerSigner = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const settlement = new ethers.Contract(
  process.env.SETTLEMENT!,
  setttlementAbi,
  provider
);
const approvalTarget = await settlement.vaultRelayer();

// Order parameters (todo read from somewhere)
const sellToken = "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83";
const buyToken = "0xe91d153e0b41518a2ce8dd3d7944fa863463a97d";
const sellAmount = "1000000"; // 1 USDC
const minBuyAmount = "100000000000000000"; // 0.1 wxDAI
const receiver = "0xc3792470cee7e0D42C2Be8e9552bd651766c5178";
const validTo = 1711992098; //Math.floor(new Date().getTime() / 1000) + 86400; // Valid for 24h

/// Initialize Safe with MultiSend, which

/// 1. Approves the sell token for VaultRelayer spending
const erc20 = new ethers.Contract(sellToken, erc20Abi, provider);
const approvalData = erc20.interface.encodeFunctionData("approve", [
  approvalTarget,
  MaxUint256,
]);

/// 2. Registers Composable CoW as extensible Fallback Handler for GPv2 Domain
const fallbackHandler = new ethers.Contract(
  process.env.FALLBACK_HANDLER!,
  fallbackHandlerAbi
);
const domainSeparator = await settlement.domainSeparator();
const setDomainVerifierData = fallbackHandler.interface.encodeFunctionData(
  "setDomainVerifier",
  [domainSeparator, process.env.COMPOSABLE_COW]
);

/// 3. Creates a limit order with the desired parameter
const limitOrder = AbiCoder.defaultAbiCoder().encode(
  ["address", "address", "uint", "uint", "address", "uint32", "bool"],
  [sellToken, buyToken, sellAmount, minBuyAmount, receiver, validTo, true]
);
const composableCow = new ethers.Contract(
  process.env.COMPOSABLE_COW!,
  composableCoWAbi
);
const createOrder = composableCow.interface.encodeFunctionData("create", [
  [process.env.LIMIT_ORDER!, ZeroHash, limitOrder],
  false,
]);

/// concat everything together into a multi-call that is used to initialize the Safe
const multisend = new ethers.Contract(process.env.MULTISEND!, multisendAbi);
const multisendData = multisend.interface.encodeFunctionData("multiSend", [
  ethers.concat([
    encodeMultiCall({
      delegateCall: false,
      target: sellToken,
      calldata: approvalData,
    }),
    encodeMultiCall({
      delegateCall: true,
      // setDomainVerifier has to be called on self (via the fallback handler)
      target: process.env.SELF_CALLER!,
      calldata: setDomainVerifierData,
    }),
    encodeMultiCall({
      delegateCall: false,
      target: process.env.COMPOSABLE_COW!,
      calldata: createOrder,
    }),
  ]),
]);

// Predict Safe Address
const safeAccountConfig: SafeAccountConfig = {
  owners: [await ownerSigner.getAddress()],
  threshold: 1,
  to: await multisend.getAddress(),
  data: multisendData,
  fallbackHandler: await fallbackHandler.getAddress(),
};
const predictedSafe: PredictedSafeProps = {
  safeAccountConfig,
};
const ethAdapter = new EthersAdapter({
  ethers,
  signerOrProvider: ownerSigner,
});
const safeSdk = await Safe.create({
  ethAdapter,
  predictedSafe,
});

const transaction = await safeSdk.createSafeDeploymentTransaction();
const appData = {
  appCode: "Safe from the Ashes",
  metadata: {
    hooks: {
      pre: [
        {
          callData: transaction.data,
          gasLimit: "1000000",
          target: transaction.to,
        },
      ],
    },
  },
};
const putAppData = await fetch("https://barn.api.cow.fi/xdai/api/v1/app_data", {
  method: "PUT",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({
    fullAppData: JSON.stringify(appData),
  }),
});
const appDataHash = await putAppData.json();
console.log(`Computed appData is ${appDataHash}`);

const safeAddress = await safeSdk.getAddress();
console.log(`Your predicted Safe address is ${safeAddress}, go fund it now`);

// // Execute
// const tx = await ownerSigner.sendTransaction(transaction);
// console.log(tx);

// Wait for Safe to be funded
while ((await erc20.balanceOf(safeAddress)) < sellAmount) {
  await sleep(10000);
}

// Place order
const signature = fallbackHandler.interface.encodeFunctionData(
  "safeSignature",
  [
    domainSeparator,
    "0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489",
    AbiCoder.defaultAbiCoder().encode(
      [
        "address",
        "address",
        "address",
        "uint",
        "uint",
        "uint32",
        "bytes32",
        "uint",
        "bytes32",
        "bool",
        "bytes32",
        "bytes32",
      ],
      [
        sellToken,
        buyToken,
        receiver,
        sellAmount,
        minBuyAmount,
        validTo,
        appDataHash,
        0,
        "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775",
        true,
        "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9",
        "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9",
      ]
    ),
    AbiCoder.defaultAbiCoder().encode(
      ["(bytes32[], (address, bytes32, bytes), bytes)"],
      [[[], [process.env.LIMIT_ORDER!, ZeroHash, limitOrder], "0x"]]
    ),
  ]
);

const postOrder = await fetch("https://barn.api.cow.fi/xdai/api/v1/orders", {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({
    sellToken,
    buyToken,
    receiver,
    sellAmount,
    buyAmount: minBuyAmount,
    validTo: validTo,
    feeAmount: "0",
    kind: "sell",
    partiallyFillable: true,
    signingScheme: "eip1271",
    signature,
    from: safeAddress,
    appData: appDataHash,
  }),
});
if (!postOrder.ok) {
  throw new Error(await postOrder.text());
}
console.log(`Order Created ${await postOrder.json()}`);

function encodeMultiCall({ delegateCall, target, calldata }) {
  // Cut 0x prefix, then count half a byte per hex char
  const length = (calldata.length - 2) / 2;
  return ethers.solidityPacked(
    ["uint8", "address", "uint256", "uint256", "bytes"],
    [delegateCall ? 1 : 0, target, 0, length, calldata]
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
