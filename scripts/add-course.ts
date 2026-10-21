/** Replaced by the staged, explicit-term catalog importer. */
export async function addCourse(_courseCode?: string): Promise<never> { throw new Error('This legacy writer is retired. Run npm run catalog:discover, then npm run catalog:refresh -- --apply. Review staged sources before enabling --extract.'); }
if (require.main === module) { console.error('This legacy writer is retired. Run npm run catalog:discover, then npm run catalog:refresh -- --apply. Review staged sources before enabling --extract.'); process.exitCode = 1; }
