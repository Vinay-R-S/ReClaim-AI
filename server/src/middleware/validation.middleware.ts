/**
 * Input Validation Middleware - zod schema validation for request payloads
 *
 * Schemas live in src/schemas, and output escaping lives in utils/html.ts.
 * This file only holds the factories that apply a schema to a request.
 */

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

interface FieldError {
  field: string;
  message: string;
}

function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.errors.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * A one-line summary for the `error` field.
 *
 * Callers show `error` and ignore `details`, so a bare "Validation failed"
 * leaves the user with no idea which field is wrong.
 */
function toSummary(prefix: string, fields: FieldError[]): string {
  const described = fields
    .slice(0, 3)
    .map((field) => (field.field ? `${field.field}: ${field.message}` : field.message))
    .join(', ');

  if (!described) return prefix;
  const more = fields.length > 3 ? ` (and ${fields.length - 3} more)` : '';
  return `${prefix}: ${described}${more}`;
}

/**
 * Validate the request body and replace it with the parsed result
 */
export function validate<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = toFieldErrors(result.error);
      res.status(400).json({ error: toSummary('Validation failed', details), details });
      return;
    }

    req.body = result.data;
    next();
  };
}

/**
 * Validate the query string and replace it with the parsed result.
 *
 * The replacement matters: without it a handler still reads the raw string,
 * so coercion and defaults declared on the schema never reach the code.
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const details = toFieldErrors(result.error);
      res.status(400).json({ error: toSummary('Invalid query parameters', details), details });
      return;
    }

    req.query = result.data as Request['query'];
    next();
  };
}

/**
 * Validate URL parameters and replace them with the parsed result
 */
export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      const details = toFieldErrors(result.error);
      res.status(400).json({ error: toSummary('Invalid URL parameters', details), details });
      return;
    }

    req.params = result.data as Request['params'];
    next();
  };
}
