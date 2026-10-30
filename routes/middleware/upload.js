import { rmSync } from 'node:fs';
import multer from 'multer';
import { AppError, LimitExceededError, ValidationError } from '../../lib/errors.js';
import { BYTES_PER_MB, toMb } from '../../lib/size.js';
import { uploadSizeMessage } from '../../domain/limits.js';
import { UNSUPPORTED_UPLOAD_MESSAGE, isZipUpload, uploadKind } from '../../media/image-types.js';
import { csrfValid, refuseCsrf } from './csrf.js';
import { newTempName } from '../../lib/upload-temp.js';
import { FORM_TEXT_BYTES } from './body.js';

const ENVELOPE_MB = 1;
const FORM_LIMITS = { fields: 10, fieldSize: FORM_TEXT_BYTES };
const UNREADABLE_MESSAGE = 'The upload could not be read. Try again.';

const LIMITS = Symbol('uploadLimits');
const CURRENT_FILE = Symbol('currentFile');

const FILES_FIELD = 'files';

function limitsOf(req) {
  const limits = req[LIMITS];
  if (!limits) throw new Error('upload middleware out of order: checkLength must run first');
  return limits;
}

export function uploadedFiles(req) {
  return Array.isArray(req.files) ? req.files : [];
}

export function removeUploadFiles(req) {
  for (const file of uploadedFiles(req)) if (file?.path) rmSync(file.path, { force: true });
}

function rejectEarly(res, next, error) {
  res.set('Connection', 'close');
  next(error);
}

function checkLength(effectiveConfigService) {
  return (req, res, next) => {
    const limits = effectiveConfigService.limitValues();
    req[LIMITS] = limits;
    const header = req.get('content-length');
    if (header === undefined) {
      return rejectEarly(
        res,
        next,
        new AppError('upload without Content-Length', { publicStatus: 411, publicMessage: UNREADABLE_MESSAGE }),
      );
    }
    const maxMb = Math.max(limits.maxUploadBatchMb, limits.maxZipUploadMb);
    const length = Number(header);
    if (!Number.isFinite(length) || length < 0) {
      return rejectEarly(
        res,
        next,
        new AppError('upload with a malformed Content-Length', {
          publicStatus: 400,
          publicMessage: UNREADABLE_MESSAGE,
        }),
      );
    }
    if (length > (maxMb + ENVELOPE_MB) * BYTES_PER_MB) {
      return rejectEarly(res, next, new LimitExceededError(uploadSizeMessage(toMb(length), maxMb)));
    }
    return next();
  };
}

function fileSizeMessage(file, limits) {
  return isZipUpload(file)
    ? `The ZIP file ${file.originalname} is larger than ${limits.maxZipUploadMb} MB.`
    : `${file.originalname} is larger than ${limits.maxImageMb} MB.`;
}

function describeError(error, limits, file) {
  if (error.code === 'LIMIT_FILE_SIZE' && file) {
    return new LimitExceededError(fileSizeMessage(file, limits), { cause: error });
  }
  if (error.code === 'LIMIT_UNEXPECTED_FILE' && error.field === FILES_FIELD) {
    const max = limits.maxImagesPerGallery;
    return new LimitExceededError(
      `This upload has more than ${max} files; at most ${max} files can be uploaded at once.`,
      {
        cause: error,
      },
    );
  }
  return null;
}

function buildParser(tmpDir, limits) {
  return multer({
    storage: multer.diskStorage({
      destination: tmpDir,
      filename: (_req, _file, cb) => cb(null, newTempName()),
    }),
    limits: { ...FORM_LIMITS, fileSize: Math.max(limits.maxImageMb, limits.maxZipUploadMb) * BYTES_PER_MB },
    defParamCharset: 'utf8',
    fileFilter: (request, file, cb) => {
      request[CURRENT_FILE] = file;
      if (uploadKind(file.originalname, file.mimetype)) return cb(null, true);
      return cb(new ValidationError(UNSUPPORTED_UPLOAD_MESSAGE));
    },
  }).array(FILES_FIELD, limits.maxImagesPerGallery);
}

function parseMultipart(tmpDir) {
  return (req, res, next) => {
    const limits = limitsOf(req);
    buildParser(tmpDir, limits)(req, res, (error) => {
      if (!error) return next();
      removeUploadFiles(req);
      if (error.syscall || error instanceof ValidationError) return next(error);
      return next(
        describeError(error, limits, req[CURRENT_FILE]) ?? new ValidationError(UNREADABLE_MESSAGE, { cause: error }),
      );
    });
  };
}

function csrfAfterParse(req, res, next) {
  if (csrfValid(req)) return next();
  removeUploadFiles(req);
  return refuseCsrf(req, res);
}

function checkSizes(req, _res, next) {
  const limits = limitsOf(req);
  const files = uploadedFiles(req);
  let total = 0;
  for (const file of files) {
    const maxMb = isZipUpload(file) ? limits.maxZipUploadMb : limits.maxImageMb;
    if (file.size > maxMb * BYTES_PER_MB) {
      removeUploadFiles(req);
      return next(new LimitExceededError(fileSizeMessage(file, limits)));
    }
    total += file.size;
  }
  if (total > limits.maxUploadBatchMb * BYTES_PER_MB) {
    removeUploadFiles(req);
    return next(new LimitExceededError(uploadSizeMessage(toMb(total), limits.maxUploadBatchMb)));
  }
  return next();
}

export function uploadFiles(effectiveConfigService, tmpDir) {
  return [checkLength(effectiveConfigService), parseMultipart(tmpDir), csrfAfterParse, checkSizes];
}
