import assertNever from "assert-never";
import {
  areBooleanLiteralTypes,
  areFloatLiteralTypes,
  areIntLiteralTypes,
  areStringLiteralTypes,
  ArrayType,
  dereferenceType,
  isNotNullType,
  isNullType,
  isObjectType,
  isReferenceType,
  isStringLiteralType,
  ObjectType,
  ReferenceType,
  IntersectionType,
  Type,
  TypeKind,
  TypeTable,
  UnionType,
  possibleRootTypes,
  SchemaProp
} from "../../types";
import {
  AllOfSchemaObject,
  ArraySchemaObject,
  BooleanSchemaObject,
  DiscriminatorObject,
  IntegerSchemaObject,
  NumberSchemaObject,
  ObjectPropertiesSchemaObject,
  ObjectSchemaObject,
  OneOfSchemaObject,
  ReferenceObject,
  SchemaObject,
  StringSchemaObject
} from "./openapi3-specification";

export function typeToSchemaOrReferenceObject(
  type: Type,
  typeTable: TypeTable,
  nullable?: boolean,
  inlineReferences?: boolean
): SchemaObject | ReferenceObject {
  switch (type.kind) {
    case TypeKind.NULL:
      throw new Error("Null must be part of a union for OpenAPI 3");
    case TypeKind.BOOLEAN:
      return booleanSchema({
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.BOOLEAN_LITERAL:
      return booleanSchema({
        values: [type.value],
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.STRING:
      return stringSchema({
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.STRING_LITERAL:
      return stringSchema({
        values: [type.value],
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.FLOAT:
      return numberSchema({
        format: "float",
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.DOUBLE:
      return numberSchema({
        format: "double",
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.FLOAT_LITERAL:
      return numberSchema({
        values: [type.value],
        format: "float",
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.INT32:
      return integerSchema({
        format: "int32",
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.INT64:
      return integerSchema({
        format: "int64",
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.INT_LITERAL:
      return integerSchema({
        values: [type.value],
        format: "int32",
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.DATE:
      return stringSchema({
        format: "date",
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.DATE_TIME:
      return stringSchema({
        format: "date-time",
        schemaProps: type.schemaProps,
        nullable
      });
    case TypeKind.OBJECT:
      return objectTypeToSchema(type, typeTable, nullable);
    case TypeKind.ARRAY:
      return arrayTypeToSchema(type, typeTable, nullable);
    case TypeKind.UNION:
      return unionTypeToSchema(type, typeTable);
    case TypeKind.INTERSECTION:
      return intersectionTypeToSchema(type, typeTable);
    case TypeKind.REFERENCE:
      if (inlineReferences)
        return typeToSchemaOrReferenceObject(dereferenceType(type, typeTable), typeTable, nullable);
      else
        return referenceTypeToSchema(type, nullable);
    default:
      assertNever(type);
  }
}

function booleanSchema(
  opts: {
    values?: boolean[];
    nullable?: boolean;
    schemaProps?: SchemaProp[];
  } = {}
): BooleanSchemaObject {
  return {
    ...{
      type: "boolean",
      enum: createEnum(opts.values, opts.nullable),
      nullable: opts.nullable || undefined
    },
    ...(<BooleanSchemaObject>schemaPropToSchemaObject(opts.schemaProps))
  };
}

function stringSchema(
  opts: {
    values?: string[];
    nullable?: boolean;
    format?: StringSchemaObject["format"];
    schemaProps?: SchemaProp[];
  } = {}
): StringSchemaObject {
  return {
    ...{
      type: "string",
      enum: createEnum(opts.values, opts.nullable),
      format: opts.format,
      nullable: opts.nullable || undefined
    },
    ...(<StringSchemaObject>schemaPropToSchemaObject(opts.schemaProps))
  };
}

function numberSchema(
  opts: {
    values?: number[];
    nullable?: boolean;
    format?: NumberSchemaObject["format"];
    schemaProps?: SchemaProp[];
  } = {}
): NumberSchemaObject {
  return {
    ...{
      type: "number",
      enum: createEnum(opts.values, opts.nullable),
      format: opts.format,
      nullable: opts.nullable || undefined
    },
    ...(<NumberSchemaObject>schemaPropToSchemaObject(opts.schemaProps))
  };
}

function integerSchema(
  opts: {
    values?: number[];
    nullable?: boolean;
    format?: IntegerSchemaObject["format"];
    schemaProps?: SchemaProp[];
  } = {}
): IntegerSchemaObject {
  return {
    ...{
      type: "integer",
      enum: createEnum(opts.values, opts.nullable),
      format: opts.format,
      nullable: opts.nullable || undefined
    },
    ...(<IntegerSchemaObject>schemaPropToSchemaObject(opts.schemaProps))
  };
}

function objectTypeToSchema(
  type: ObjectType,
  typeTable: TypeTable,
  nullable?: boolean
): ObjectSchemaObject {
  const properties =
    type.properties.length > 0
      ? type.properties.reduce<ObjectPropertiesSchemaObject>(
          (acc, property) => {
            const propType = typeToSchemaOrReferenceObject(
              property.type,
              typeTable
            );
            if (!isReferenceObject(propType)) {
              propType.description = property.description;
            }
            acc[property.name] = propType;
            return acc;
          },
          {}
        )
      : undefined;

  const requiredProperties = type.properties
    .filter(p => !p.optional)
    .map(p => p.name);
  const required =
    requiredProperties.length > 0 ? requiredProperties : undefined;
  return {
    ...{
      type: "object",
      properties,
      required,
      nullable: nullable || undefined
    },
    ...(<ObjectSchemaObject>schemaPropToSchemaObject(type.schemaProps))
  };
}

function arrayTypeToSchema(
  type: ArrayType,
  typeTable: TypeTable,
  nullable?: boolean
): ArraySchemaObject {
  return {
    ...{
      type: "array",
      items: typeToSchemaOrReferenceObject(type.elementType, typeTable),
      nullable: nullable || undefined
    },
    ...(<ArraySchemaObject>schemaPropToSchemaObject(type.schemaProps))
  };
}

/**
 * Unions are NOT flattened
 */
function unionTypeToSchema(
  type: UnionType,
  typeTable: TypeTable
): SchemaObject | ReferenceObject {
  // Sanity check
  if (type.types.length === 0) {
    throw new Error("Unexpected type: union with no types");
  }

  const nullable = type.types.some(isNullType);
  const nonNullTypes = type.types.filter(isNotNullType);

  switch (nonNullTypes.length) {
    case 0: // previous guard guarantees only null was present
      throw new Error("Null must be part of a union for OpenAPI 3");
    case 1: // not an OpenAPI union, but a single type, possibly nullable
      return typeToSchemaOrReferenceObject(
        nonNullTypes[0],
        typeTable,
        nullable
      );
    default:
      if (areBooleanLiteralTypes(nonNullTypes)) {
        return booleanSchema({
          values: nonNullTypes.map(t => t.value),
          schemaProps: type.schemaProps,
          nullable
        });
      } else if (areStringLiteralTypes(nonNullTypes)) {
        return stringSchema({
          values: nonNullTypes.map(t => t.value),
          schemaProps: type.schemaProps,
          nullable
        });
      } else if (areFloatLiteralTypes(nonNullTypes)) {
        return numberSchema({
          values: nonNullTypes.map(t => t.value),
          format: "float",
          schemaProps: type.schemaProps,
          nullable
        });
      } else if (areIntLiteralTypes(nonNullTypes)) {
        return integerSchema({
          values: nonNullTypes.map(t => t.value),
          format: "int32",
          schemaProps: type.schemaProps,
          nullable
        });
      } else {
        return {
          ...{
            nullable: nullable || undefined,
            oneOf: nonNullTypes.map(t =>
              typeToSchemaOrReferenceObject(t, typeTable)
            ),
            discriminator: unionTypeToDiscrimintorObject(type, typeTable)
          },
          ...(<OneOfSchemaObject>schemaPropToSchemaObject(type.schemaProps))
        };
      }
  }
}

function unionTypeToDiscrimintorObject(
  unionType: UnionType,
  typeTable: TypeTable
): DiscriminatorObject | undefined {
  if (unionType.discriminator === undefined) return undefined;

  const nonNullTypes = unionType.types.filter(isNotNullType);

  // Discriminator mapping is only supported for reference types
  // however reference can even point to union or
  // intersection types. This ensures those also meet the
  // requirement
  const objectReferenceOnly = nonNullTypes.every(t => {
    return (
      isReferenceType(t) && possibleRootTypes(t, typeTable).every(isObjectType)
    );
  });

  if (!objectReferenceOnly) return { propertyName: unionType.discriminator };

  const mapping = nonNullTypes.reduce<{ [key: string]: string }>((acc, t) => {
    // Sanity check and type cast
    if (!isReferenceType(t)) {
      throw new Error("Unexpected error: expected reference type");
    }

    const concreteTypes = possibleRootTypes(t, typeTable);

    // Sanity check and type cast
    if (!concreteTypes.every(isObjectType)) {
      throw new Error("Unexpected error: expected object reference type");
    }

    // Retrieve the discriminator property
    // Discriminator properties cannot be optional - we assume this is handled by the type parser
    // We first determine the object which contains the discriminator
    // followed by which we identify the prop itself.
    // This helps us identify discriminators even if one of the unions is an intersection or is
    // a union of unions
    const discriminatorObject = concreteTypes.find(object => {
      return object.properties.find(p => p.name === unionType.discriminator);
    });

    if (discriminatorObject === undefined) {
      throw new Error(
        "Unexpected error: could not find expected discriminator property in objects"
      );
    }

    const discriminatorProp = discriminatorObject.properties.find(
      p => p.name === unionType.discriminator
    );

    if (discriminatorProp === undefined) {
      throw new Error(
        "Unexpected error: could not find expected discriminator property"
      );
    }

    // Extract the property type - this is expected to be a string literal
    const discriminatorPropType = dereferenceType(
      discriminatorProp.type,
      typeTable
    );
    if (!isStringLiteralType(discriminatorPropType)) {
      throw new Error(
        "Unexpected error: expected discriminator property type to be a string literal"
      );
    }

    acc[discriminatorPropType.value] = referenceObjectValue(t.name);
    return acc;
  }, {});

  return {
    propertyName: unionType.discriminator,
    mapping
  };
}

function intersectionTypeToSchema(
  type: IntersectionType,
  typeTable: TypeTable
): SchemaObject | ReferenceObject {
  // Sanity check: This should not be possible
  if (type.types.length === 0) {
    throw new Error("Unexpected type: intersection type with no types");
  }

  const nullable = type.types.some(isNullType);
  const nonNullTypes = type.types.filter(isNotNullType);

  return {
    ...{
      nullable: nullable || undefined,
      allOf: nonNullTypes.map((t: Type) =>
        typeToSchemaOrReferenceObject(t, typeTable)
      )
    },
    ...(<AllOfSchemaObject>schemaPropToSchemaObject(type.schemaProps))
  };
}

function referenceTypeToSchema(
  type: ReferenceType,
  nullable?: boolean
): ReferenceObject {
  return {
    $ref: referenceObjectValue(type.name),
    nullable: nullable || undefined
  };
}

function referenceObjectValue(referenceName: string): string {
  return `#/components/schemas/${referenceName}`;
}

/**
 * Enum generation helper
 */
function createEnum<T>(
  values?: T[],
  nullable?: boolean
): (T | null)[] | undefined {
  if (!values) return;
  return nullable ? [...values, null] : values;
}

type SchemaPropType = Omit<
  SchemaObject,
  | "type"
  | "items"
  | "format"
  | "enum"
  | "nullable"
  | "properties"
  | "required"
  | "oneOf"
  | "allOf"
  | "discriminator"
  | "not"
  | "anyOf"
>;
function schemaPropToSchemaObject(
  schemaProps?: SchemaProp[]
): SchemaPropType | undefined {
  return schemaProps?.reduce((acc, schemaProp: SchemaProp) => {
    Object.assign(acc, { [schemaProp.name]: schemaProp.value });
    return acc;
  }, {});
}

export function isReferenceObject(
  typeObject: SchemaObject | ReferenceObject
): typeObject is ReferenceObject {
  return "$ref" in typeObject;
}
