import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse } from 'yaml';

const schema = JSON.parse(readFileSync('scripts/render-blueprint.schema.json', 'utf8'));
const blueprint = parse(readFileSync('render.yaml', 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
if (!validate(blueprint)) throw new Error(`Render Blueprint schema validation failed:\n${(validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? ''}`).join('\n')}`);
console.log(`Render Blueprint schema validation passed against ${schema.$id}.`);
