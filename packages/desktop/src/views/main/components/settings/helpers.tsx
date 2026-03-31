import type { ReactNode } from "react";
import type { ModelInfo } from "../../../../shared/rpc";
import {
	Combobox,
	ComboboxInput,
	ComboboxPopup,
	ComboboxList,
	ComboboxItem,
	ComboboxEmpty,
} from "@plot/ui/components/combobox";

export function Row({
	label,
	description,
	children,
}: {
	label: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-start justify-between py-2 border-b border-border/20 last:border-0">
			<div className="flex flex-col gap-1 pt-0.5">
				<span className="text-xs">{label}</span>
				{description && (
					<span className="text-[10px] text-muted-foreground">
						{description}
					</span>
				)}
			</div>
			{children}
		</div>
	);
}


export function ModelCombobox({
	models,
	selectedModel,
	onSelect,
}: {
	models: ModelInfo[];
	selectedModel: string;
	onSelect: (modelId: string) => void;
}) {
	const selected = models.find((m) => m.id === selectedModel) ?? null;

	return (
		<Combobox<ModelInfo>
			items={models}
			value={selected}
			onValueChange={(model) => {
				if (model) onSelect(model.id);
			}}
			itemToStringLabel={(m) => m.name}
			itemToStringValue={(m) => m.id}
		>
			<ComboboxInput
				size="sm"
				placeholder="Search models..."
				showTrigger
				className="flex-1"
			/>
			<ComboboxPopup>
				<ComboboxEmpty>No models found.</ComboboxEmpty>
				<ComboboxList>
					{(model: ModelInfo) => (
						<ComboboxItem
							key={model.id}
							value={model}
							className="min-h-6 text-xs sm:min-h-5.5 sm:text-xs"
						>
							{model.name}
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxPopup>
		</Combobox>
	);
}
