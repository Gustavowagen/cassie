-- Admin-authored house rules text, shown to players via the lobby's "House
-- rules" button. Sibling to `description`, not part of `theme` (which is
-- strictly visual: primary color + background).
alter table casinos add column rules text;
