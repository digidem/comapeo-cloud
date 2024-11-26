class HttpError extends Error {
  /**
   * @readonly
   * @prop {number}
   */
  statusCode

  /**
   * @readonly
   * @prop {string}
   */
  code

  /**
   * @param {number} statusCode
   * @param {Uppercase<string>} code
   * @param {string} message
   */
  constructor(statusCode, code, message) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

/** @param {string} message */
export const badRequestError = (message) =>
  new HttpError(400, 'BAD_REQUEST', message)

export const invalidBearerToken = () =>
  new HttpError(401, 'UNAUTHORIZED', 'Invalid bearer token')

export const projectNotInAllowlist = () =>
  new HttpError(403, 'PROJECT_NOT_IN_ALLOWLIST', 'Project not allowed')

export const tooManyProjects = () =>
  new HttpError(
    403,
    'TOO_MANY_PROJECTS',
    'Server is already linked to the maximum number of projects',
  )

export const projectNotFoundError = () =>
  new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found')

/** @param {never} value */
export const shouldBeImpossibleError = (value) =>
  new Error(`${value} should be impossible`)

/**
 * @param {string} str
 * @returns {string}
 */
export const normalizeCode = (str) => {
  switch (str) {
    case 'FST_ERR_VALIDATION':
      return 'BAD_REQUEST'
    default:
      return str.toUpperCase().replace(/[^A-Z]/gu, '_')
  }
}
