/*  global describe:true it:true */
import chai, { expect } from 'chai';
import nock from 'nock';
// import Record from 'marc-record-js';
import chaiAsPromised from 'chai-as-promised';
import { show, validateRecord, fileFix } from '../src/operations.js';

chai.use(chaiAsPromised);

const testRec = `
  <record>
    <leader>00000cca^a22000007i^4500</leader>
    <controlfield tag="001">009877349</controlfield>
    <controlfield tag="003">FI-MELINDA</controlfield>
    <controlfield tag="005">20171218125223.0</controlfield>
    <controlfield tag="007">qu</controlfield>
    <controlfield tag="008">170103s2016^^^^xxu||z|^^||||||||^|^zxx|c</controlfield>
    <datafield tag="035" ind1=" " ind2=" ">
      <subfield code="a">(FI-MELINDA)009877349</subfield>
    </datafield>
    <datafield tag="084" ind1=" " ind2=" ">
      <subfield code="a">78.852</subfield>
      <subfield code="2">ykl</subfield>
    </datafield>
    <datafield tag="100" ind1="1" ind2=" ">
      <subfield code="a">Smith, Sam,</subfield>
      <subfield code="e">säveltäjä.</subfield>
    </datafield>
    <datafield tag="245" ind1="1" ind2="0">
      <subfield code="a">Writing's on the wall.</subfield>
    </datafield>
    <datafield tag="336" ind1=" " ind2=" ">
      <subfield code="a">nuottikirjoitus</subfield>
      <subfield code="b">ntm</subfield>
      <subfield code="2">rdacontent</subfield>
    </datafield>
    <datafield tag="337" ind1=" " ind2=" ">
      <subfield code="a">käytettävissä ilman laitetta</subfield>
      <subfield code="b">n</subfield>
      <subfield code="2">rdamedia</subfield>
    </datafield>
    <datafield tag="700" ind1="1" ind2=" ">
      <subfield code="a">Napier, James,</subfield>
      <subfield code="e">säveltäjä.</subfield>
    </datafield>
    <datafield tag="740" ind1="0" ind2=" ">
      <subfield code="a">Spectre.</subfield>
    </datafield>
    <datafield tag="773" ind1="0" ind2=" ">
      <subfield code="7">nncm</subfield>
      <subfield code="w">(FI-MELINDA)009877249</subfield>
      <subfield code="t">101 movie hits. Trumpet. -</subfield>
      <subfield code="d">Milwaukee, WI : Hal Leonard, [2016]. -</subfield>
      <subfield code="m">1 soolonuotti (117 sivua). -</subfield>
      <subfield code="z">978-1-4950-6067-0,</subfield>
      <subfield code="o">HL00158091</subfield>
    </datafield></record>`;

describe('show', () => {
  beforeEach(() => {
    nock(process.env.VALIDATE_API)
      .get('/bib/009877349')
      .reply(200, testRec);
  });

  it('Should be able to fetch a record', async () => {
    const res = await show('009877349');
    expect(res).to.be.a('string');
  });
});

describe('validateRecord', () => {
  beforeEach(() => {
    nock(process.env.VALIDATE_API)
      .get('/bib/009877349')
      .reply(200, testRec);
  });
  it('Should be able to fetch a record', async () => {
    const res = await validateRecord('009877349');
    expect(res).to.be.an.instanceOf(Object);
    expect(res).to.have.property('originalRecord');
    expect(res).to.have.property('validatedRecord');
    expect(res).to.have.property('results');
    expect(res).to.have.property('revalidationResults');
  });

  it('Should throw because the id is invalid', async () => {
    expect(validateRecord('MOIKKA!')).to.be.rejected;
    expect(validateRecord('123!')).to.be.rejected;
    expect(validateRecord('1 23')).to.be.rejected;
    expect(validateRecord('123019824981274981274')).to.be.rejected;
  });
});

describe('fileFix', () => {
  it('Should throw because the file format is invalid', () => {
    expect(fileFix('./data/testrecord.end')).to.be.rejected;
  });
});
