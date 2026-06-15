/**
 * game.jsp getBuyDataSA / doVerify 와 동일한지 node --test 로 확인
 * npm run test:pension
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPensionConnProForm,
  buildSaBuyPayload,
  buildVerifyAutoForm,
  parseVerifyNoResponse,
} from './verify.js';

describe('buildSaBuyPayload (getBuyDataSA)', () => {
  it('모든조 SA 수동 5매 — BUY_NO 형식', () => {
    const p = buildSaBuyPayload('', '123456', 'SA', 'M');
    assert.equal(p.buyCnt, 5);
    assert.equal(p.buyNo, '1123456,2123456,3123456,4123456,5123456');
    assert.equal(p.buySetType, 'SA,SA,SA,SA,SA');
    assert.equal(p.buyType, 'M,M,M,M,M');
    assert.equal(p.tickets.length, 5);
  });

  it('앞자리 0 포함 6자리', () => {
    const p = buildSaBuyPayload('', '012345', 'SA', 'M');
    assert.equal(p.buyNo, '1012345,2012345,3012345,4012345,5012345');
  });

  it('단일 조 S', () => {
    const p = buildSaBuyPayload('3', '654321', 'S', 'M');
    assert.equal(p.buyCnt, 1);
    assert.equal(p.buyNo, '3654321');
    assert.equal(p.buySetType, 'S');
  });
});

describe('buildVerifyAutoForm (frmauto)', () => {
  it('SA — SEL_CLASS 빈값, BUY_CNT 5', () => {
    const form = buildVerifyAutoForm(300, { group: 1, digits: '123456', setType: 'SA' });
    assert.equal(form.get('ROUND'), '300');
    assert.equal(form.get('AUTO_SEL_SET'), 'SA');
    assert.equal(form.get('SEL_CLASS'), '');
    assert.equal(form.get('SEL_NO'), '123456');
    assert.equal(form.get('BUY_TYPE'), 'M');
    assert.equal(form.get('BUY_CNT'), '5');
  });
});

describe('parseVerifyNoResponse (doVerify)', () => {
  it('recommendYN=N → 구매 가능', () => {
    const r = parseVerifyNoResponse(
      300,
      { group: 1, digits: '123456', setType: 'SA' },
      {
        resultCode: '100',
        verifyYn: 'Y',
        recommendYN: 'N',
        round: '300',
        selLotNo: '123456',
        selClsNo: '',
        autoSelSet: 'SA',
        selBuyType: 'M',
      }
    );
    assert.equal(r.available, true);
    assert.equal(r.digits, '123456');
    assert.equal(r.buyNo, '1123456,2123456,3123456,4123456,5123456');
  });

  it('recommendYN!=N → 매진 + 대체', () => {
    const r = parseVerifyNoResponse(
      300,
      { group: 1, digits: '123456', setType: 'SA' },
      {
        resultCode: '100',
        verifyYn: 'Y',
        recommendYN: 'Y',
        round: '300',
        selLotNo: '111111,222222',
        selClsNo: 'SA,SA',
        autoSelSet: 'SA,SA',
      }
    );
    assert.equal(r.available, false);
    assert.ok(r.alternatives.length >= 2);
  });

  it('회차 불일치 → 오류', () => {
    assert.throws(
      () =>
        parseVerifyNoResponse(
          300,
          { group: 1, digits: '123456', setType: 'SA' },
          { resultCode: '100', verifyYn: 'Y', recommendYN: 'N', round: '299', selLotNo: '123456', autoSelSet: 'SA' }
        ),
      /회차 불일치/
    );
  });

  it('verifyYn!=Y → 오류', () => {
    assert.throws(
      () =>
        parseVerifyNoResponse(
          300,
          { group: 1, digits: '123456', setType: 'SA' },
          { resultCode: '100', verifyYn: 'N', recommendYN: 'N', round: '300' }
        ),
      /구매 불가/
    );
  });
});

describe('buildPensionConnProForm (#frm → connPro)', () => {
  it('검증된 SA 티켓 + 주문번호', () => {
    const tickets = buildSaBuyPayload('', '123456', 'SA', 'M').tickets;
    const form = buildPensionConnProForm(300, tickets, 50000, {
      orderNo: 'ORD001',
      orderDate: '20260601',
    });
    assert.equal(form.get('ROUND'), '300');
    assert.equal(form.get('BUY_NO'), '1123456,2123456,3123456,4123456,5123456');
    assert.equal(form.get('BUY_CNT'), '5');
    assert.equal(form.get('PAY_TYPE'), 'M');
    assert.equal(form.get('orderNo'), 'ORD001');
    assert.equal(form.get('curpay'), '5000');
    assert.equal(form.get('verifyYN'), 'N');
  });
});
