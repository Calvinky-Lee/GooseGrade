/** Blanket normalization/deletion is deliberately unavailable. */
console.error('This legacy writer is retired. Run npm run catalog:discover, then npm run catalog:refresh -- --apply. Review staged sources before enabling --extract.');
process.exitCode = 1;
export {};
