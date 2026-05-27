let ioRef = null;

function setIO(io) {
  ioRef = io || null;
  return ioRef;
}

function getIO() {
  if (!ioRef) throw new Error("Socket.io not initialized");
  return ioRef;
}

module.exports = {
  setIO,
  getIO,
};
