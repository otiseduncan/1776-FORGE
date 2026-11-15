-- NEW D1 only. Do not run against any legacy database.
INSERT OR IGNORE INTO resource_links(id,name,url,description,category,source_kind,status) VALUES
('archives','National Archives','https://www.archives.gov/founding-docs','Original founding documents and federal historical records.','Founding documents','official','active'),
('constitution','Constitution Annotated','https://constitution.congress.gov/','Congressional Research Service constitutional research.','Constitutional law','official','active'),
('congress','Congress.gov','https://www.congress.gov/','Federal bills and congressional activity.','Legislation','official','active'),
('govinfo','GovInfo','https://www.govinfo.gov/','Official federal legal publications.','Official publications','official','active'),
('scotus','U.S. Supreme Court Opinions','https://www.supremecourt.gov/opinions/opinions.aspx','Published opinions of the Supreme Court.','Judicial decisions','official','active'),
('galegis','Georgia General Assembly','https://www.legis.ga.gov/','Georgia legislation and legislative records.','State legislation','official','active'),
('gaopen','Georgia Open Government Law','https://law.georgia.gov/key-issues/open-government/law','Georgia open records and meetings guidance.','Public access','official','active');
