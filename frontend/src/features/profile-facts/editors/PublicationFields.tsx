// SPDX-License-Identifier: Apache-2.0
/** 论文编辑字段（payload 见契约 §3.1 publication）。隐藏字段由字段设置决定，不渲染。 */
import { Col, Row } from "antd";
import { PUBLICATION_STATUS_OPTIONS } from "../constants";
import { isFieldHidden, translateOptions, type HiddenFields } from "./fieldHelpers";
import { FactSelectField, FactTextAreaField, FactTextField, FactUrlField } from "./fields";
import PersonRows from "./PersonRows";

const STATUS_OPTIONS = translateOptions(PUBLICATION_STATUS_OPTIONS);

interface Props {
  hiddenFields: HiddenFields;
}

export default function PublicationFields({ hiddenFields }: Props) {
  const hidden = (key: string) => isFieldHidden(hiddenFields, key);
  return (
    <>
      {hidden("title") ? null : (
        <FactTextField
          name="title"
          labelKey="research.publications.title"
          placeholderKey="research.publications.titlePlaceholder"
          requiredMessageKey="research.required.title"
          maxLength={512}
        />
      )}
      {hidden("authors") ? null : <PersonRows name="authors" role="author" />}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={10}>
          {hidden("venue") ? null : (
            <FactTextField
              name="venue"
              labelKey="research.publications.venue"
              placeholderKey="research.publications.venuePlaceholder"
              maxLength={256}
            />
          )}
        </Col>
        <Col xs={12} md={4}>
          {hidden("year") ? null : (
            <FactTextField name="year" labelKey="research.publications.year" maxLength={8} />
          )}
        </Col>
        <Col xs={12} md={10}>
          {hidden("status") ? null : (
            <FactSelectField
              name="status"
              labelKey="research.publications.status"
              options={STATUS_OPTIONS}
            />
          )}
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={10}>
          {hidden("doi") ? null : (
            <FactTextField
              name="doi"
              labelKey="research.publications.doi"
              placeholderKey="research.publications.doiPlaceholder"
              maxLength={256}
            />
          )}
        </Col>
        <Col xs={24} md={14}>
          {hidden("url") ? null : (
            <FactUrlField
              name="url"
              labelKey="research.publications.url"
              placeholderKey="research.publications.urlPlaceholder"
            />
          )}
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={10}>
          {hidden("volume_pages") ? null : (
            <FactTextField
              name="volume_pages"
              labelKey="research.publications.volumePages"
              placeholderKey="research.publications.volumePagesPlaceholder"
              maxLength={64}
            />
          )}
        </Col>
        <Col xs={24} md={14}>
          {hidden("note") ? null : (
            <FactTextAreaField
              name="note"
              labelKey="research.publications.note"
              maxLength={2000}
              rows={2}
            />
          )}
        </Col>
      </Row>
    </>
  );
}
