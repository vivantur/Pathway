function isDeadInteractionError(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}

module.exports = {
  isDeadInteractionError,
};
