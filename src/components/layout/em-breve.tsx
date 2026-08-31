type EmBreveProps = {
  titulo: string
}

/**
 * Página reaproveitável para itens de navegação cujas telas ainda não
 * foram implementadas (Integrações, Convide e ganhe, Perfil, Ajuda,
 * Etiquetas, Carteira). Evita link quebrado ou 404 enquanto a
 * funcionalidade não nasce em sua própria tarefa.
 */
export function EmBreve({ titulo }: EmBreveProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-superficie-card p-12 text-center">
      <h1 className="text-xl font-bold text-texto-principal">{titulo}</h1>
      <p className="max-w-sm text-sm text-texto-secundario">
        Esta área ainda não está disponível. Estamos trabalhando para trazer essa funcionalidade
        em breve.
      </p>
    </div>
  )
}
