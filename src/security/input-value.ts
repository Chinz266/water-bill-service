import { registerDecorator, ValidationArguments } from 'class-validator';

type Kind = 'text' | 'number' | 'integer' | 'boolean';
type Options = { min?: number; max?: number; maxLength?: number };

/** Validate provided values without coercing objects, arrays, or multipart strings.
 * Required fields retain their IsDefined decorators and service business rules.
 * Missing/null fields remain compatible with partial updates and nullable columns.
 */
export function InputValue(
  kind: Kind,
  options: Options = {},
): PropertyDecorator {
  return (target, property) =>
    registerDecorator({
      name: 'inputValue',
      target: target.constructor,
      propertyName: String(property),
      validator: {
        validate(value: unknown): boolean {
          if (value === undefined || value === null) return true;
          if (kind === 'text')
            return (
              typeof value === 'string' &&
              value.length <= (options.maxLength ?? 1000)
            );
          if (kind === 'boolean') return typeof value === 'boolean';
          if (typeof value !== 'number' && typeof value !== 'string')
            return false;
          if (
            typeof value === 'string' &&
            !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())
          )
            return false;
          const number = Number(value);
          return (
            Number.isFinite(number) &&
            (kind !== 'integer' || Number.isSafeInteger(number)) &&
            number >= (options.min ?? -Number.MAX_SAFE_INTEGER) &&
            number <= (options.max ?? Number.MAX_SAFE_INTEGER)
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `ข้อมูล ${args.property} มีชนิด ขนาด หรือค่าไม่ถูกต้อง`;
        },
      },
    });
}
