export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      advisor_notes: {
        Row: {
          advisor_id: string
          created_at: string
          id: string
          note: string
          session_id: string
        }
        Insert: {
          advisor_id: string
          created_at?: string
          id?: string
          note: string
          session_id: string
        }
        Update: {
          advisor_id?: string
          created_at?: string
          id?: string
          note?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "advisor_notes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_answers: {
        Row: {
          field_key: string
          field_label: string
          id: string
          section: string
          session_id: string
          updated_at: string
          value: string | null
        }
        Insert: {
          field_key: string
          field_label: string
          id?: string
          section: string
          session_id: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          field_key?: string
          field_label?: string
          id?: string
          section?: string
          session_id?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_messages: {
        Row: {
          created_at: string
          id: string
          role: string
          section: string | null
          session_id: string
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          section?: string | null
          session_id: string
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          section?: string | null
          session_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_sessions: {
        Row: {
          current_question_index: number
          current_section: string
          customer_id: string
          followup_count: number
          id: string
          introducer_id: string | null
          lead_source: Database["public"]["Enums"]["lead_source"] | null
          referral_channel: Database["public"]["Enums"]["referral_channel"] | null
          started_at: string
          status: Database["public"]["Enums"]["session_status"]
          submitted_at: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          current_question_index?: number
          current_section?: string
          customer_id: string
          followup_count?: number
          id?: string
          introducer_id?: string | null
          lead_source?: Database["public"]["Enums"]["lead_source"] | null
          referral_channel?: Database["public"]["Enums"]["referral_channel"] | null
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          submitted_at?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          current_question_index?: number
          current_section?: string
          customer_id?: string
          followup_count?: number
          id?: string
          introducer_id?: string | null
          lead_source?: Database["public"]["Enums"]["lead_source"] | null
          referral_channel?: Database["public"]["Enums"]["referral_channel"] | null
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          submitted_at?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_sessions_introducer_id_fkey"
            columns: ["introducer_id"]
            isOneToOne: false
            referencedRelation: "introducers"
            referencedColumns: ["id"]
          },
        ]
      }
      introducer_leads: {
        Row: {
          channel: Database["public"]["Enums"]["referral_channel"]
          created_at: string
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          id: string
          introducer_id: string
          lead_source: Database["public"]["Enums"]["lead_source"]
          notes: string | null
          session_id: string | null
          status: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["referral_channel"]
          created_at?: string
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          id?: string
          introducer_id: string
          lead_source?: Database["public"]["Enums"]["lead_source"]
          notes?: string | null
          session_id?: string | null
          status?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["referral_channel"]
          created_at?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          id?: string
          introducer_id?: string
          lead_source?: Database["public"]["Enums"]["lead_source"]
          notes?: string | null
          session_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "introducer_leads_introducer_id_fkey"
            columns: ["introducer_id"]
            isOneToOne: false
            referencedRelation: "introducers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "introducer_leads_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      introducers: {
        Row: {
          active: boolean
          company_name: string
          contact_email: string | null
          created_at: string
          id: string
          slug: string
          user_id: string
        }
        Insert: {
          active?: boolean
          company_name: string
          contact_email?: string | null
          created_at?: string
          id?: string
          slug: string
          user_id: string
        }
        Update: {
          active?: boolean
          company_name?: string
          contact_email?: string | null
          created_at?: string
          id?: string
          slug?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "customer" | "advisor" | "introducer"
      lead_source: "web" | "telephone" | "mobile" | "introducer_portal" | "referral_link"
      referral_channel: "voice" | "text" | "direct_booking" | "manual"
      session_status: "in_progress" | "submitted"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["customer", "advisor", "introducer"],
      lead_source: ["web", "telephone", "mobile", "introducer_portal", "referral_link"],
      referral_channel: ["voice", "text", "direct_booking", "manual"],
      session_status: ["in_progress", "submitted"],
    },
  },
} as const
