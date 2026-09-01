import { codigosPadraoDoMotor } from '@/domain/simulacao/roteiro'
import { listarCatalogoPadrao } from '@/server/admin/status-rastreio'
import { obterConfigSimulacao } from '@/server/simulacao-config'
import { CatalogoStatus } from '@/components/admin/catalogo-status'

/**
 * Catálogo padrão de status de rastreio da plataforma.
 *
 * O que se edita aqui vale para toda conta que nunca personalizou nada — a
 * maioria. O catálogo próprio de um cliente continua sendo dele; esta tela
 * não o sobrescreve.
 */
export default async function PaginaStatusRastreio() {
  const [linhas, config] = await Promise.all([listarCatalogoPadrao(), obterConfigSimulacao()])

  return (
    <>
      <div>
        <h1 className="text-titulo font-bold text-texto-principal">Status de rastreio</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Catálogo padrão da plataforma. Vale para envios <strong>novos</strong>: a linha do tempo
          é materializada na emissão da etiqueta, então quem já está em trânsito não é reescrito.
        </p>
      </div>

      <CatalogoStatus
        linhas={linhas.map((linha) => ({
          id: linha.id,
          codigo: linha.codigo,
          titulo: linha.titulo,
          descricao: linha.descricao,
          cenario: linha.cenario,
          fracaoPrazo: linha.fracaoPrazo,
          diasAposEmissao: linha.diasAposEmissao,
          statusResultante: linha.statusResultante,
          ativo: linha.ativo,
        }))}
        codigosDoMotor={codigosPadraoDoMotor()}
        fatorVelocidade={config.fatorVelocidade}
      />
    </>
  )
}
