import { randomBytes } from 'node:crypto';

const TEMP_NAME = /^[0-9a-f]{32}$/;

export const newTempName = () => randomBytes(16).toString('hex');

export const isTempName = (name) => TEMP_NAME.test(name);
