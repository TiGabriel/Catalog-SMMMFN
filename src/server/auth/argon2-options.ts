/** argon2id (library default) with OWASP-recommended minimum parameters. Shared with CLI scripts. */
export const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;
