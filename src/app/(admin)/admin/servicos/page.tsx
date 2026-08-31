import { listarTransportadoras } from '@/server/admin/servicos'
import { PainelServicos } from '@/components/admin/painel-servicos'

/**
 * Transportadoras e serviços.
 *
 * Fecha o buraco entre a importação de tabela de preço, que casa serviço por
 * código, e o catálogo em si — que até aqui só nascia pelo seed e não tinha
 * tela nenhuma.
 */
export default async function PaginaServicos() {
  const transportadoras = await listarTransportadoras()
  const servicos = transportadoras.flatMap((t) => t.servicos)
  const ativos = servicos.filter((s) => s.ativo).length

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-texto-principal">Transportadoras e serviços</h1>
        <p className="text-sm text-texto-secundario">
          {ativos} de {servicos.length} serviço(s) ativos. Serviço desativado sai das cotações
          novas; envios e cotações já feitos continuam apontando para ele.
        </p>
      </div>

      <PainelServicos transportadoras={transportadoras} />
    </>
  )
}
