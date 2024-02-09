### Counterfactual CoW Safe Order

This repository contains a sample script allowing you to place a CoW Swap order from a Safe that doesn't yet exist. Once funded the Safe will deploy itself as part of the order's pre hook and send the proceeds back tot he account from which the script is executed.

With a few modifications this could become a powerful paradigm to support use cases such as:

1. Bridge funds from chain A to the counterfactual Safe address on chain B
2. Use CoW Swap on Chain B for the swap
3. In a post hook, bridge funds back to original account on chain A

And many more...

## How to run

```bash
cp .env.example .env # then enter your private key in the .env file
npm install
npx ts-node index.ts
```
