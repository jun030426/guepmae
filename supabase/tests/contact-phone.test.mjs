import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isValidContactPhone} from '../functions/_shared/contactPhone.js';
test('contact phone accepts domestic mobile, local, internet and business numbers', () => {
  for (const phone of ['010-0000-0000','033-123-4567','031-1234-5678','02-123-4567','02-1234-5678','070-1234-5678','1588-1234']) assert.equal(isValidContactPhone(phone), true, phone);
  for (const phone of ['', '123', 'abc', '+1 555 0100', '010-1234-56789', '01012345678;123', null]) assert.equal(isValidContactPhone(phone), false, String(phone));
});
