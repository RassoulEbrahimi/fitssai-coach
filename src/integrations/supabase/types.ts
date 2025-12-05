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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_feedback: {
        Row: {
          accepted: boolean
          created_at: string
          id: string
          reason: string | null
          suggestion_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted?: boolean
          created_at?: string
          id?: string
          reason?: string | null
          suggestion_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted?: boolean
          created_at?: string
          id?: string
          reason?: string | null
          suggestion_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_logs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          latency_ms: number
          model: string
          status_code: number | null
          success: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms: number
          model: string
          status_code?: number | null
          success?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number
          model?: string
          status_code?: number | null
          success?: boolean
          user_id?: string
        }
        Relationships: []
      }
      deletion_requests: {
        Row: {
          cancelled: boolean
          cancelled_at: string | null
          confirmation_token: string
          confirmed: boolean
          confirmed_at: string | null
          deletion_date: string
          id: string
          requested_at: string
          user_id: string
        }
        Insert: {
          cancelled?: boolean
          cancelled_at?: string | null
          confirmation_token: string
          confirmed?: boolean
          confirmed_at?: string | null
          deletion_date: string
          id?: string
          requested_at?: string
          user_id: string
        }
        Update: {
          cancelled?: boolean
          cancelled_at?: string | null
          confirmation_token?: string
          confirmed?: boolean
          confirmed_at?: string | null
          deletion_date?: string
          id?: string
          requested_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nutrition_plans: {
        Row: {
          content: Json
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age: number
          avatar_path: string | null
          created_at: string
          dietary_preference: string
          experience_level: string | null
          fitness_goal: string
          full_name: string | null
          height: number
          id: string
          updated_at: string
          weight: number
        }
        Insert: {
          age: number
          avatar_path?: string | null
          created_at?: string
          dietary_preference: string
          experience_level?: string | null
          fitness_goal: string
          full_name?: string | null
          height: number
          id: string
          updated_at?: string
          weight: number
        }
        Update: {
          age?: number
          avatar_path?: string | null
          created_at?: string
          dietary_preference?: string
          experience_level?: string | null
          fitness_goal?: string
          full_name?: string | null
          height?: number
          id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workout_logs: {
        Row: {
          calories_burned: number
          completed: boolean
          completed_at: string | null
          created_at: string
          day_index: number | null
          duration_minutes: number
          exercise_index: number | null
          id: string
          plan_id: string | null
          user_id: string
          week_key: string | null
          workout_day: string
        }
        Insert: {
          calories_burned?: number
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          day_index?: number | null
          duration_minutes?: number
          exercise_index?: number | null
          id?: string
          plan_id?: string | null
          user_id: string
          week_key?: string | null
          workout_day: string
        }
        Update: {
          calories_burned?: number
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          day_index?: number | null
          duration_minutes?: number
          exercise_index?: number | null
          id?: string
          plan_id?: string | null
          user_id?: string
          week_key?: string | null
          workout_day?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_logs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "workout_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_plans: {
        Row: {
          content: Json
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_stats: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_current_user_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
