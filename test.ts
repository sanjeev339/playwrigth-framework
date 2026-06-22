import { detectFieldFaker } from './tests/data/fieldDetector';
console.log("Role:", detectFieldFaker("Role", "QA TEST MAGT"));
console.log("Role Name:", detectFieldFaker("Role Name", "QA TEST MAGT"));
