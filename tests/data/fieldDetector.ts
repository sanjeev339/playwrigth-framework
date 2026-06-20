import { faker } from '@faker-js/faker';

type FakerFn = () => string;

/**
 * Maps a payload field name to a Faker generator function.
 * Returns null if the field should NOT be dynamically generated
 * (e.g. Role, Status, IDs that must match real DB values).
 */
export function detectFieldFaker(key: string, _currentValue: string): FakerFn | null {
  const k = key.toLowerCase().replace(/[\s_\-]+/g, '');

  // ── NEVER fake — must match real DB records or enums
  if (/^(id|recordid|uuid|userid|fleetid|vehicleid|driverid|partid)$/.test(k)) return null;
  if (/^(role|status|type|category|strategy|edgecasetype)$/.test(k)) return null;

  // ── NAME FIELDS
  if (/firstname/.test(k))            return () => faker.person.firstName();
  if (/lastname/.test(k))             return () => faker.person.lastName();
  if (/^(fullname|name)$/.test(k))    return () => faker.person.fullName();
  if (/username|displayname/.test(k)) return () => faker.internet.userName().slice(0, 20);

  // ── EMAIL — unique per run to prevent DB unique constraint failures
  if (/email/.test(k)) {
    return () => {
      const local = faker.internet.userName().toLowerCase().replace(/[^a-z0-9]/g, '');
      const suffix = faker.string.alphanumeric(5).toLowerCase();
      return `${local}.${suffix}@testmail.io`;
    };
  }

  // ── PHONE
  if (/phone|mobile|contact/.test(k)) return () => '+91 ' + faker.string.numeric(10);

  // ── ADDRESS
  if (/^address$/.test(k))            return () => faker.location.streetAddress();
  if (/city/.test(k))                 return () => faker.location.city();
  if (/state/.test(k))                return () => faker.location.state({ abbreviated: true });
  if (/zip|postal/.test(k))           return () => faker.location.zipCode('#####');
  if (/country/.test(k))              return () => faker.location.country();

  // ── DATES
  if (/^(date|dob|birthday)$/.test(k)) {
    return () => faker.date.past({ years: 5 }).toISOString().split('T')[0]!;
  }
  if (/createdat|updatedat/.test(k)) {
    return () => faker.date.recent({ days: 30 }).toISOString();
  }

  // ── NUMERIC
  if (/year/.test(k))               return () => String(faker.number.int({ min: 2018, max: 2025 }));
  if (/amount|price|cost/.test(k))  return () => faker.commerce.price({ min: 10, max: 9999 });
  if (/quantity|count/.test(k))     return () => String(faker.number.int({ min: 1, max: 100 }));

  // ── VEHICLE / FLEET
  if (/licenseplate/.test(k))  return () => faker.vehicle.vrm();
  if (/^make$/.test(k))        return () => faker.vehicle.manufacturer();
  if (/^model$/.test(k))       return () => faker.vehicle.model();
  if (/^vin$/.test(k))         return () => faker.vehicle.vin();
  if (/color/.test(k))         return () => faker.vehicle.color();

  // ── COMPANY / CONTENT
  if (/company|organization/.test(k))           return () => faker.company.name();
  if (/description|notes?|comments?/.test(k))   return () => faker.lorem.sentence();
  if (/^title$/.test(k))                        return () => faker.lorem.words(3);
  if (/reason|message|remarks?/.test(k))        return () => faker.lorem.sentence();
  if (/partname/.test(k))                       return () => `Part-${faker.string.alphanumeric(8).toUpperCase()}`;

  // ── SECRETS — NEVER faked
  if (/password|secret|token|jwt|apikey/.test(k)) return null;

  return null;
}
