function mockUser(req, res, next) {
  // Hard-code user để dev/test (sau này thay bằng auth thật)
  req.user = {
    sub: "demo_user_id_001",
    username: "demo_user",
  };
  next();
}

module.exports = { mockUser };
