// Hand-written Supabase database types, kept in sync with supabase/migrations/*.
// Once a real Supabase project exists, prefer regenerating this file with
// `supabase gen types typescript` — but the shape must match the migrations
// either way, so this hand-written version is the correct starting point and
// remains valid input to a diff-based regeneration.

export type MemberRole = 'admin' | 'trainer' | 'viewer'
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled'
export type HomeAway = 'home' | 'away'
export type MatchLineupSide = 'own' | 'opponent'
export type MatchEventType =
  | 'goal'
  | 'own_goal'
  | 'yellow_card'
  | 'second_yellow'
  | 'red_card'
  | 'substitution'
  | 'penalty_scored'
  | 'penalty_missed'
  | 'halftime'
  | 'fulltime'
export type SceneStatus = 'candidate' | 'ai_observed' | 'needs_review' | 'trainer_verified' | 'trainer_corrected' | 'rejected'
export type SceneSource = 'ai_detection' | 'trainer_note' | 'manual' | 'match_event_anchor'
export type IdentificationStatus = 'confirmed' | 'probable' | 'unknown'
export type EvidenceLevel = 'fact' | 'observation' | 'inference' | 'hypothesis'
export type AnalysisStage = 'candidate_detection' | 'scene_observation' | 'tactical_inference' | 'report_generation'
export type AnalysisJobStatus = 'queued' | 'waiting_for_worker' | 'processing' | 'requires_review' | 'completed' | 'failed'
export type ReportType = 'post_match' | 'scouting'
export type ReportStatus = 'draft' | 'published'
export type SyncRunStatus = 'running' | 'completed' | 'failed'
export type DataSourceType = 'bfv' | 'fupa' | 'wildenroth_tippspiel' | 'veo' | 'trainer' | 'manual' | 'video_analysis' | 'computed_statistic'
export type RecordingProvider = 'veo' | 'manual' | 'external'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

interface Relationship<FK extends string = string, Ref extends string = string> {
  foreignKeyName: string
  columns: FK[]
  isOneToOne?: boolean
  referencedRelation: Ref
  referencedColumns: string[]
}

// Only the FK relationships actually embedded via `.select('alias:fk_column(...)')`
// or `table!inner(...)` anywhere in the app need to be listed here — postgrest-js
// uses this purely for embed type resolution, not for anything at runtime
// (the real FKs are the `references` constraints in the migrations).
interface Table<Row, Insert, Rel extends Relationship[] = [], Update = Partial<Insert>> {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: Rel
}

export interface Database {
  public: {
    Tables: {
      organizations: Table<
        { id: string; name: string; slug: string; created_at: string },
        { id?: string; name: string; slug: string; created_at?: string }
      >
      squads: Table<
        { id: string; org_id: string; name: string; slug: string; level: string | null; is_active: boolean; created_at: string },
        { id?: string; org_id: string; name: string; slug: string; level?: string | null; is_active?: boolean; created_at?: string }
      >
      profiles: Table<
        { id: string; display_name: string; avatar_url: string | null; created_at: string },
        { id: string; display_name: string; avatar_url?: string | null; created_at?: string },
        [],
        { display_name?: string; avatar_url?: string | null }
      >
      memberships: Table<
        { id: string; org_id: string; profile_id: string; squad_id: string | null; role: MemberRole; created_at: string },
        { id?: string; org_id: string; profile_id: string; squad_id?: string | null; role: MemberRole; created_at?: string }
      >
      seasons: Table<
        { id: string; org_id: string; name: string; start_date: string; end_date: string | null; is_current: boolean; created_at: string },
        { id?: string; org_id: string; name: string; start_date: string; end_date?: string | null; is_current?: boolean; created_at?: string }
      >
      competitions: Table<
        { id: string; org_id: string; name: string; competition_type: 'league' | 'cup' | 'friendly'; created_at: string },
        { id?: string; org_id: string; name: string; competition_type?: 'league' | 'cup' | 'friendly'; created_at?: string }
      >
      teams: Table<
        { id: string; org_id: string; name: string; short_name: string | null; is_own_club: boolean; external_ref: Json | null; created_at: string },
        { id?: string; org_id: string; name: string; short_name?: string | null; is_own_club?: boolean; external_ref?: Json | null; created_at?: string }
      >
      players: Table<
        { id: string; org_id: string; first_name: string; last_name: string; is_goalkeeper: boolean; birth_year: number | null; is_active: boolean; external_ids: Json; created_at: string },
        { id?: string; org_id: string; first_name: string; last_name: string; is_goalkeeper?: boolean; birth_year?: number | null; is_active?: boolean; external_ids?: Json; created_at?: string }
      >
      player_squad_memberships: Table<
        { id: string; player_id: string; squad_id: string; season_id: string; position: string | null; jersey_number: number | null; status: 'active' | 'injured' | 'transferred_out' | 'retired' | 'guest'; created_at: string },
        { id?: string; player_id: string; squad_id: string; season_id: string; position?: string | null; jersey_number?: number | null; status?: 'active' | 'injured' | 'transferred_out' | 'retired' | 'guest'; created_at?: string },
        [
          { foreignKeyName: 'player_squad_memberships_player_id_fkey'; columns: ['player_id']; referencedRelation: 'players'; referencedColumns: ['id'] },
          { foreignKeyName: 'player_squad_memberships_squad_id_fkey'; columns: ['squad_id']; referencedRelation: 'squads'; referencedColumns: ['id'] },
        ]
      >
      matches: Table<
        {
          id: string; org_id: string; squad_id: string; season_id: string; competition_id: string | null
          opponent_team_id: string; matchday: number | null; home_away: HomeAway; kickoff_at: string
          status: MatchStatus; our_score: number | null; opponent_score: number | null
          ht_our_score: number | null; ht_opponent_score: number | null; venue: string | null
          goalscorer_squad_confirmed_at: string | null; manually_edited_fields: string[]
          created_at: string; updated_at: string
        },
        {
          id?: string; org_id: string; squad_id: string; season_id: string; competition_id?: string | null
          opponent_team_id: string; matchday?: number | null; home_away: HomeAway; kickoff_at: string
          status?: MatchStatus; our_score?: number | null; opponent_score?: number | null
          ht_our_score?: number | null; ht_opponent_score?: number | null; venue?: string | null
          goalscorer_squad_confirmed_at?: string | null; manually_edited_fields?: string[]
          created_at?: string; updated_at?: string
        },
        [
          { foreignKeyName: 'matches_opponent_team_id_fkey'; columns: ['opponent_team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] },
          { foreignKeyName: 'matches_squad_id_fkey'; columns: ['squad_id']; referencedRelation: 'squads'; referencedColumns: ['id'] },
          { foreignKeyName: 'matches_competition_id_fkey'; columns: ['competition_id']; referencedRelation: 'competitions'; referencedColumns: ['id'] },
        ]
      >
      match_lineups: Table<
        { id: string; match_id: string; side: MatchLineupSide; formation: string | null; formation_source: string | null; created_at: string },
        { id?: string; match_id: string; side: MatchLineupSide; formation?: string | null; formation_source?: string | null; created_at?: string }
      >
      lineup_players: Table<
        {
          id: string; lineup_id: string; player_id: string | null; raw_player_name: string | null
          jersey_number: number | null; is_starting: boolean; is_captain: boolean; minutes_played: number | null
          sub_in_minute: number | null; sub_out_minute: number | null
          goals: number; assists: number; yellow_cards: number; red_card_minute: number | null
          penalty_missed: boolean; manually_edited_fields: string[]; created_at: string
        },
        {
          id?: string; lineup_id: string; player_id?: string | null; raw_player_name?: string | null
          jersey_number?: number | null; is_starting?: boolean; is_captain?: boolean; minutes_played?: number | null
          sub_in_minute?: number | null; sub_out_minute?: number | null
          goals?: number; assists?: number; yellow_cards?: number; red_card_minute?: number | null
          penalty_missed?: boolean; manually_edited_fields?: string[]; created_at?: string
        },
        [{ foreignKeyName: 'lineup_players_player_id_fkey'; columns: ['player_id']; referencedRelation: 'players'; referencedColumns: ['id'] }]
      >
      match_events: Table<
        {
          id: string; match_id: string; event_type: MatchEventType; side: MatchLineupSide | null
          minute: number | null; stoppage_minute: number | null; player_id: string | null
          opponent_player_name: string | null; related_player_id: string | null; detail: Json
          source_import_id: string | null; created_at: string
        },
        {
          id?: string; match_id: string; event_type: MatchEventType; side?: MatchLineupSide | null
          minute?: number | null; stoppage_minute?: number | null; player_id?: string | null
          opponent_player_name?: string | null; related_player_id?: string | null; detail?: Json
          source_import_id?: string | null; created_at?: string
        }
      >
      data_sources: Table<
        { id: string; org_id: string; source_type: DataSourceType; name: string; config: Json; is_active: boolean; created_at: string },
        { id?: string; org_id: string; source_type: DataSourceType; name: string; config?: Json; is_active?: boolean; created_at?: string }
      >
      source_imports: Table<
        {
          id: string; org_id: string; data_source_id: string; entity_type: string; entity_id: string
          source_identifier: string | null; confidence: number | null; raw_payload: Json | null
          imported_at: string; last_synced_at: string | null
        },
        {
          id?: string; org_id: string; data_source_id: string; entity_type: string; entity_id: string
          source_identifier?: string | null; confidence?: number | null; raw_payload?: Json | null
          imported_at?: string; last_synced_at?: string | null
        },
        [{ foreignKeyName: 'source_imports_data_source_id_fkey'; columns: ['data_source_id']; referencedRelation: 'data_sources'; referencedColumns: ['id'] }]
      >
      data_conflicts: Table<
        {
          id: string; org_id: string; entity_type: string; entity_id: string; field_name: string
          conflicting_values: Json; resolved_at: string | null; resolved_by: string | null
          resolution_value: Json | null; created_at: string
        },
        {
          id?: string; org_id: string; entity_type: string; entity_id: string; field_name: string
          conflicting_values: Json; resolved_at?: string | null; resolved_by?: string | null
          resolution_value?: Json | null; created_at?: string
        }
      >
      recordings: Table<
        {
          id: string; match_id: string; provider: RecordingProvider; external_url: string | null
          provider_recording_id: string | null; title: string | null; recorded_at: string | null
          duration_seconds: number | null; sync_status: 'linked' | 'processing' | 'ready' | 'failed' | 'waiting_for_worker'
          added_by: string | null; created_at: string
        },
        {
          id?: string; match_id: string; provider: RecordingProvider; external_url?: string | null
          provider_recording_id?: string | null; title?: string | null; recorded_at?: string | null
          duration_seconds?: number | null; sync_status?: 'linked' | 'processing' | 'ready' | 'failed' | 'waiting_for_worker'
          added_by?: string | null; created_at?: string
        }
      >
      trainer_notes: Table<
        {
          id: string; match_id: string; author_id: string; minute: number; second: number | null
          category: string | null; note_text: string; linked_scene_id: string | null; created_at: string
        },
        {
          id?: string; match_id: string; author_id: string; minute: number; second?: number | null
          category?: string | null; note_text: string; linked_scene_id?: string | null; created_at?: string
        },
        [{ foreignKeyName: 'trainer_notes_match_id_fkey'; columns: ['match_id']; referencedRelation: 'matches'; referencedColumns: ['id'] }]
      >
      scene_candidates: Table<
        {
          id: string; match_id: string; recording_id: string | null; start_second: number; end_second: number
          source: SceneSource; detection_type: string | null; trainer_note_id: string | null
          match_event_id: string | null; created_at: string
        },
        {
          id?: string; match_id: string; recording_id?: string | null; start_second: number; end_second: number
          source: SceneSource; detection_type?: string | null; trainer_note_id?: string | null
          match_event_id?: string | null; created_at?: string
        }
      >
      scenes: Table<
        {
          id: string; match_id: string; recording_id: string | null; scene_candidate_id: string | null
          start_second: number; end_second: number; status: SceneStatus; created_by: string | null
          reviewed_by: string | null; reviewed_at: string | null; review_comment: string | null
          created_at: string; updated_at: string
        },
        {
          id?: string; match_id: string; recording_id?: string | null; scene_candidate_id?: string | null
          start_second: number; end_second: number; status?: SceneStatus; created_by?: string | null
          reviewed_by?: string | null; reviewed_at?: string | null; review_comment?: string | null
          created_at?: string; updated_at?: string
        },
        [{ foreignKeyName: 'scenes_match_id_fkey'; columns: ['match_id']; referencedRelation: 'matches'; referencedColumns: ['id'] }]
      >
      scene_tags: Table<
        { id: string; scene_id: string; tag: string; applied_by: string | null; created_at: string },
        { id?: string; scene_id: string; tag: string; applied_by?: string | null; created_at?: string }
      >
      scene_participants: Table<
        {
          id: string; scene_id: string; player_id: string | null; jersey_number: number | null
          team_side: MatchLineupSide; identification_status: IdentificationStatus
          identification_confidence: number | null; confirmed_by: string | null; created_at: string
        },
        {
          id?: string; scene_id: string; player_id?: string | null; jersey_number?: number | null
          team_side: MatchLineupSide; identification_status?: IdentificationStatus
          identification_confidence?: number | null; confirmed_by?: string | null; created_at?: string
        }
      >
      evidence_items: Table<
        {
          id: string; scene_id: string; level: EvidenceLevel; text: string; confidence: number | null
          created_by_ai: boolean; analysis_job_id: string | null; structured_data: Json
          confirmed_by: string | null; confirmed_at: string | null; corrected_from_text: string | null
          created_at: string
        },
        {
          id?: string; scene_id: string; level: EvidenceLevel; text: string; confidence?: number | null
          created_by_ai?: boolean; analysis_job_id?: string | null; structured_data?: Json
          confirmed_by?: string | null; confirmed_at?: string | null; corrected_from_text?: string | null
          created_at?: string
        }
      >
      analysis_jobs: Table<
        {
          id: string; match_id: string; stage: AnalysisStage; status: AnalysisJobStatus; provider: string
          model: string | null; input_ref: Json; error: string | null; retry_count: number
          started_at: string | null; completed_at: string | null; created_by: string | null; created_at: string
        },
        {
          id?: string; match_id: string; stage: AnalysisStage; status?: AnalysisJobStatus; provider: string
          model?: string | null; input_ref?: Json; error?: string | null; retry_count?: number
          started_at?: string | null; completed_at?: string | null; created_by?: string | null; created_at?: string
        }
      >
      ai_usage: Table<
        {
          id: string; analysis_job_id: string; provider: string; model: string | null
          input_tokens: number | null; output_tokens: number | null; cost_estimate_usd: number | null; created_at: string
        },
        {
          id?: string; analysis_job_id: string; provider: string; model?: string | null
          input_tokens?: number | null; output_tokens?: number | null; cost_estimate_usd?: number | null; created_at?: string
        }
      >
      training_recommendations: Table<
        {
          id: string; org_id: string; squad_id: string; title: string; rationale: string; training_goal: string
          organization_form: Json; coaching_points: string[]; progression: string | null; regression: string | null
          supporting_scene_ids: string[]; created_by: string | null; created_at: string
        },
        {
          id?: string; org_id: string; squad_id: string; title: string; rationale: string; training_goal: string
          organization_form?: Json; coaching_points?: string[]; progression?: string | null; regression?: string | null
          supporting_scene_ids: string[]; created_by?: string | null; created_at?: string
        }
      >
      reports: Table<
        {
          id: string; org_id: string; squad_id: string; match_id: string | null; report_type: ReportType
          status: ReportStatus; created_by: string | null; published_at: string | null; created_at: string
        },
        {
          id?: string; org_id: string; squad_id: string; match_id?: string | null; report_type: ReportType
          status?: ReportStatus; created_by?: string | null; published_at?: string | null; created_at?: string
        }
      >
      report_versions: Table<
        { id: string; report_id: string; version: number; content: Json; pdf_path: string | null; created_by: string | null; created_at: string },
        { id?: string; report_id: string; version: number; content: Json; pdf_path?: string | null; created_by?: string | null; created_at?: string }
      >
      audit_logs: Table<
        {
          id: string; org_id: string; actor_id: string | null; entity_type: string; entity_id: string
          action: string; before_value: Json | null; after_value: Json | null; comment: string | null; created_at: string
        },
        {
          id?: string; org_id: string; actor_id?: string | null; entity_type: string; entity_id: string
          action: string; before_value?: Json | null; after_value?: Json | null; comment?: string | null; created_at?: string
        }
      >
      sync_runs: Table<
        {
          id: string; org_id: string; data_source_id: string; squad_id: string; status: SyncRunStatus
          matches_created: number; matches_updated: number; matches_unchanged: number; conflicts_created: number
          error: string | null; started_at: string; finished_at: string | null; started_by: string | null
        },
        {
          id?: string; org_id: string; data_source_id: string; squad_id: string; status?: SyncRunStatus
          matches_created?: number; matches_updated?: number; matches_unchanged?: number; conflicts_created?: number
          error?: string | null; started_at?: string; finished_at?: string | null; started_by?: string | null
        },
        [{ foreignKeyName: 'sync_runs_data_source_id_fkey'; columns: ['data_source_id']; referencedRelation: 'data_sources'; referencedColumns: ['id'] }]
      >
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
