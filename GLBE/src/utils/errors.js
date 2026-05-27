class AppError extends Error {
  constructor(message, statusCode = 400, code = "APP_ERROR", details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

module.exports = { AppError };
