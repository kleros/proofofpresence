// A V10 match made through this app requires the exact reviewed metadata to
// remain available. This does not alter the contract or outside callers.
/** @param {any} record @param {()=>Promise<any>} verify */
export async function requireAvailableV10CaseMetadata(record, verify) {
  const reject = () => { throw Object.assign(new Error("Verify the published case document before matching."),
    { code: "CASE_METADATA_NOT_VERIFIED", status: 409 }); };
  if (record?.productionCase !== true || record.status !== "verified" || !record.artifact) reject();
  const result = await verify();
  if (result?.publication?.status !== "verified" || result?.artifact?.sha256 !== record.artifact.sha256 ||
      result?.artifact?.scopeHash !== record.artifact.scopeHash || result?.artifact?.uri !== record.artifact.uri) reject();
}
