-- ============================================================================
-- Papyrus — Migration 011 : Policies DELETE et UPDATE sur submissions
-- Permet aux membres d'équipe de supprimer et modifier des réponses
-- ============================================================================

create policy "team deletes submissions" on submissions for delete
  using (
    exists (
      select 1 from forms f
      where f.id = submissions.form_id
        and is_team_member(f.team_id)
    )
  );

create policy "team updates submissions" on submissions for update
  using (
    exists (
      select 1 from forms f
      where f.id = submissions.form_id
        and is_team_member(f.team_id)
    )
  )
  with check (
    exists (
      select 1 from forms f
      where f.id = submissions.form_id
        and is_team_member(f.team_id)
    )
  );