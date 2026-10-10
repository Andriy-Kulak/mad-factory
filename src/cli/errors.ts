/**
 * Loaded before every CLI (`node --import`): a missing key prints the setup steps and exits 1 instead of a stack
 * trace. Any other error keeps Node's default output.
 */
process.on("uncaughtException", (error) => {
  if (error instanceof Error && error.name === "MissingConfigError") console.error(`\n${error.message}\n`);
  else console.error(error);
  process.exit(1);
});
